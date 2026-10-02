"""Worker de la cola `analysis` (feature 007, contracts/analysis-job.md).

Servicio `analysis-worker` (`python -m analytics.mining.worker`, imagen `Dockerfile.mining`). No
accede a MongoDB (plan, ajuste 1): descarga la entrada por una URL firmada, ejecuta el análisis,
sube los resultados por otra URL firmada y devuelve un resumen. Los errores previstos terminan el
job con `status: failed` y un código; el detalle solo va al log.
"""

import asyncio
import gzip
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import httpx
from bullmq import Job
from fastapi import FastAPI
from pydantic import Field, RedisDsn, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from analytics import queue_worker
from analytics.logging import bind_request_id, configure_logging, reset_request_id
from analytics.mining.run import Outcome, ProgressFn
from analytics.mining.schemas import (
    AnalysisInputFile,
    AnalysisJobInput,
    AnalysisJobReturn,
    AnalysisResults,
    ErrorCode,
    ProgressStage,
)
from analytics.queue_worker import QueueOptions, QueueWorker

QUEUE = "analysis"
SERVICE = "analysis-worker"
TRANSFER_TIMEOUT_S = 60

logger = logging.getLogger("analytics.mining.worker")

Processor = Callable[
    [AnalysisJobInput, AnalysisInputFile, AnalysisResults | None, ProgressFn], Awaitable[Outcome]
]


class AnalysisError(Exception):
    """Fallo previsto del análisis; el código es lo único que llega a `api`."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    redis_url: RedisDsn = Field(validation_alias="REDIS_URL")
    host: str = Field(default="::", validation_alias="HOST")
    port: int = Field(default=8001, ge=0, le=65535, validation_alias="PORT")
    concurrency: int = Field(default=1, ge=1, le=4, validation_alias="ANALYSIS_CONCURRENCY")
    timeout_s: float = Field(default=900, gt=0, validation_alias="ANALYSIS_TIMEOUT_S")
    heartbeat_s: float = Field(default=10, gt=0, validation_alias="ANALYSIS_HEARTBEAT_S")
    heartbeat_ttl_s: int = Field(default=30, ge=1, validation_alias="ANALYSIS_HEARTBEAT_TTL_S")
    # Prefijos: los de `api` (BullMQ usa `bull`); las pruebas usan los suyos.
    queue_prefix: str = Field(default="bull", validation_alias="ANALYSIS_QUEUE_PREFIX")
    key_prefix: str = Field(default="", validation_alias="ANALYSIS_KEY_PREFIX")
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = Field(
        default="INFO", validation_alias="LOG_LEVEL"
    )
    app_version: str = Field(default="dev", validation_alias="APP_VERSION")
    git_sha: str = Field(default="unknown", validation_alias="GIT_SHA")


async def _download(client: httpx.AsyncClient, url: str, code: str) -> Any:
    try:
        response = await client.get(url)
        response.raise_for_status()
        return json.loads(gzip.decompress(response.content))
    except (httpx.HTTPError, OSError, ValueError):
        raise AnalysisError(code) from None


def _failed(code: str) -> dict[str, Any]:
    summary = AnalysisJobReturn(
        status="failed", partial=False, detailCount=0, stages={}, error=ErrorCode(code=code)
    )
    return summary.model_dump(mode="json", exclude_none=True)


class AnalysisWorker(QueueWorker):
    def __init__(self, settings: WorkerSettings, process: Processor) -> None:
        super().__init__(
            QueueOptions(
                queue=QUEUE,
                redis_url=str(settings.redis_url),
                queue_prefix=settings.queue_prefix,
                heartbeat_key=f"{settings.key_prefix}analysis:worker",
                concurrency=settings.concurrency,
                lock_ms=int((settings.timeout_s + 60) * 1000),
                heartbeat_s=settings.heartbeat_s,
                heartbeat_ttl_s=settings.heartbeat_ttl_s,
            ),
            self._handle,
        )
        self.settings = settings
        self.process = process

    async def _handle(self, job: Job, token: str) -> dict[str, Any]:
        try:
            payload = AnalysisJobInput.model_validate(job.data)
        except ValidationError:
            logger.error("entrada del job inválida", extra={"job_id": job.id})
            return _failed("INVALID_JOB")

        request_token = bind_request_id(payload.requestId) if payload.requestId else None
        extra = {"run_id": payload.runId, "project_id": payload.projectId, "kind": payload.kind}
        started = time.perf_counter()

        async def progress(stage: ProgressStage, pct: int) -> None:
            await job.updateProgress({"stage": stage, "pct": pct})

        try:
            logger.info("análisis iniciado", extra=extra)
            summary = await asyncio.wait_for(
                self._run(payload, progress), timeout=self.settings.timeout_s
            )
            logger.info(
                "análisis terminado",
                extra={
                    **extra,
                    "partial": summary["partial"],
                    "details": summary["detailCount"],
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
            return summary
        except TimeoutError:
            logger.warning("análisis con error", extra={**extra, "code": "TIMEOUT"})
            return _failed("TIMEOUT")
        except AnalysisError as error:
            logger.warning("análisis con error", extra={**extra, "code": error.code})
            return _failed(error.code)
        except Exception as error:
            # El detalle solo va al log; el job termina con un código genérico.
            logger.exception("análisis fallido", extra={**extra, "error": type(error).__name__})
            return _failed("INTERNAL")
        finally:
            if request_token is not None:
                reset_request_id(request_token)

    async def _run(self, payload: AnalysisJobInput, progress: ProgressFn) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TRANSFER_TIMEOUT_S) as client:
            await progress("download", 0)
            try:
                data = AnalysisInputFile.model_validate(
                    await _download(client, str(payload.inputUrl), "INPUT_DOWNLOAD_FAILED")
                )
            except ValidationError:
                raise AnalysisError("INVALID_INPUT") from None
            previous = None
            if payload.previousResultsUrl is not None:
                try:
                    previous = AnalysisResults.model_validate(
                        await _download(
                            client, str(payload.previousResultsUrl), "PREVIOUS_RESULTS_FAILED"
                        )
                    )
                except ValidationError:
                    raise AnalysisError("PREVIOUS_RESULTS_FAILED") from None

            outcome = await self.process(payload, data, previous, progress)

            await progress("upload", 100)
            body = gzip.compress(
                outcome.results.model_dump_json(by_alias=True, exclude_none=True).encode()
            )
            try:
                response = await client.put(
                    str(payload.resultsUrl),
                    content=body,
                    headers={"content-type": "application/gzip"},
                )
                response.raise_for_status()
            except httpx.HTTPError:
                raise AnalysisError("RESULTS_UPLOAD_FAILED") from None

        summary = AnalysisJobReturn(
            status="done",
            partial=outcome.partial,
            detailCount=outcome.detail_count,
            stages=outcome.results.stages,
        )
        return summary.model_dump(mode="json", exclude_none=True)


def create_health_app(worker: AnalysisWorker) -> FastAPI:
    return queue_worker.create_health_app(
        worker, SERVICE, worker.settings.app_version, worker.settings.git_sha
    )


def default_processor() -> Processor:
    """El orquestador con las técnicas registradas; se importa aquí para arrancar antes."""
    import analytics.mining.techniques  # noqa: F401 - registra las técnicas en TECHNIQUES
    from analytics.mining.run import process

    return process


async def serve(settings: WorkerSettings, process: Processor) -> None:
    worker = AnalysisWorker(settings, process)
    await queue_worker.serve(worker, create_health_app(worker), settings.host, settings.port)


def run() -> None:
    settings = queue_worker.load_settings(WorkerSettings)
    configure_logging(settings.log_level, service=SERVICE)
    asyncio.run(serve(settings, default_processor()))


if __name__ == "__main__":
    run()
