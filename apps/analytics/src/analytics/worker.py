"""Worker de la cola `detection` (feature 006, contracts/detection-job.md).

Proceso aparte (`python -m analytics.worker`, servicio `analytics-worker` en Railway) para que el
OCR no bloquee el `/health` ni las peticiones de `analytics`. Consume los jobs que encola `api`,
publica el progreso, devuelve el resultado validado (nunca escribe en MongoDB, Principio II) y
falla con el código en el mensaje. La conexión, el latido en Redis y `GET /health` son los de
`analytics.queue_worker` (plan, ajuste 10).
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from bullmq import Job
from fastapi import FastAPI
from pydantic import Field, RedisDsn, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from analytics import queue_worker
from analytics.detection.errors import DetectionError
from analytics.detection.schemas import DetectionJobInput, DetectionResult, Stage
from analytics.logging import bind_request_id, configure_logging, reset_request_id
from analytics.queue_worker import QueueOptions, QueueWorker

QUEUE = "detection"
SERVICE = "analytics-worker"

logger = logging.getLogger("analytics.worker")


ProgressFn = Callable[[Stage, int], Awaitable[None]]
Processor = Callable[[DetectionJobInput, ProgressFn], Awaitable[DetectionResult]]


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    redis_url: RedisDsn = Field(validation_alias="REDIS_URL")
    host: str = Field(default="::", validation_alias="HOST")
    port: int = Field(default=8001, ge=0, le=65535, validation_alias="PORT")
    concurrency: int = Field(default=1, ge=1, le=8, validation_alias="DETECTION_CONCURRENCY")
    timeout_s: float = Field(default=180, gt=0, validation_alias="DETECTION_TIMEOUT_S")
    heartbeat_s: float = Field(default=10, gt=0, validation_alias="DETECTION_HEARTBEAT_S")
    heartbeat_ttl_s: int = Field(default=30, ge=1, validation_alias="DETECTION_HEARTBEAT_TTL_S")
    # Prefijos: los de `api` (BullMQ usa `bull`); las pruebas usan los suyos.
    queue_prefix: str = Field(default="bull", validation_alias="DETECTION_QUEUE_PREFIX")
    key_prefix: str = Field(default="", validation_alias="DETECTION_KEY_PREFIX")
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = Field(
        default="INFO", validation_alias="LOG_LEVEL"
    )
    app_version: str = Field(default="dev", validation_alias="APP_VERSION")
    git_sha: str = Field(default="unknown", validation_alias="GIT_SHA")


class DetectionWorker(QueueWorker):
    def __init__(self, settings: WorkerSettings, process: Processor) -> None:
        super().__init__(
            QueueOptions(
                queue=QUEUE,
                redis_url=str(settings.redis_url),
                queue_prefix=settings.queue_prefix,
                heartbeat_key=f"{settings.key_prefix}detection:worker",
                concurrency=settings.concurrency,
                lock_ms=int((settings.timeout_s + 30) * 1000),
                heartbeat_s=settings.heartbeat_s,
                heartbeat_ttl_s=settings.heartbeat_ttl_s,
            ),
            self._handle,
        )
        self.settings = settings
        self.process = process

    async def _handle(self, job: Job, token: str) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            payload = DetectionJobInput.model_validate(job.data)
        except ValidationError:
            logger.error("entrada del job inválida", extra={"job_id": job.id})
            raise DetectionError("INTERNAL") from None

        request_token = bind_request_id(payload.requestId)
        extra = {"job_id": payload.jobId, "version_id": payload.versionId}
        try:
            logger.info("detección iniciada", extra=extra)

            async def progress(stage: Stage, pct: int) -> None:
                await job.updateProgress({"stage": stage, "pct": pct})

            try:
                result = await asyncio.wait_for(
                    self.process(payload, progress), timeout=self.settings.timeout_s
                )
            except TimeoutError:
                raise DetectionError("TIMEOUT") from None
            except DetectionError:
                raise
            except Exception as error:
                # El detalle solo va al log; el job falla con un código genérico.
                logger.exception(
                    "detección fallida", extra={**extra, "error": type(error).__name__}
                )
                raise DetectionError("INTERNAL") from None

            logger.info(
                "detección terminada",
                extra={
                    **extra,
                    "activities": len(result.activities),
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
            return result.model_dump(mode="json", by_alias=True)
        except DetectionError as error:
            logger.warning("detección con error", extra={**extra, "code": error.code})
            raise
        finally:
            reset_request_id(request_token)


def create_health_app(worker: DetectionWorker) -> FastAPI:
    return queue_worker.create_health_app(
        worker, SERVICE, worker.settings.app_version, worker.settings.git_sha
    )


def default_processor() -> Processor:
    """El pipeline real; se importa aquí para que el worker arranque sin cargar OpenCV antes."""
    from analytics.detection.pipeline import process

    return process


async def serve(settings: WorkerSettings, process: Processor) -> None:
    worker = DetectionWorker(settings, process)
    await queue_worker.serve(worker, create_health_app(worker), settings.host, settings.port)


def run() -> None:
    settings = queue_worker.load_settings(WorkerSettings)
    configure_logging(settings.log_level, service=SERVICE)
    asyncio.run(serve(settings, default_processor()))


if __name__ == "__main__":
    run()
