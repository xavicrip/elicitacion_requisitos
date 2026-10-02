"""Worker de la cola `detection` (feature 006, contracts/detection-job.md).

Proceso aparte (`python -m analytics.worker`, servicio `analytics-worker` en Railway) para que el
OCR no bloquee el `/health` ni las peticiones de `analytics`. Consume los jobs que encola `api`,
publica el progreso, devuelve el resultado validado (nunca escribe en MongoDB, Principio II) y
falla con el código en el mensaje. Expone `GET /health` para el healthcheck y escribe un latido
en Redis que `api /health/deep` comprueba (plan, ajuste 10).
"""

import asyncio
import json
import logging
import os
import signal
import socket
import sys
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Literal, cast

import uvicorn
from bullmq import Job, Worker
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import Field, RedisDsn, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis

from analytics.detection.errors import DetectionError
from analytics.detection.schemas import DetectionJobInput, DetectionResult, Stage
from analytics.logging import bind_request_id, configure_logging, reset_request_id
from analytics.main import dual_stack_socket

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


class DetectionWorker:
    def __init__(self, settings: WorkerSettings, process: Processor) -> None:
        self.settings = settings
        self.process = process
        self.id = f"{socket.gethostname()}-{os.getpid()}"
        self._worker: Worker | None = None
        self._redis: Redis | None = None
        self._heartbeat: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._worker is not None and not self._worker.closing

    @property
    def redis(self) -> Redis:
        assert self._redis is not None, "El worker no está iniciado"
        return self._redis

    async def start(self) -> None:
        self._redis = Redis.from_url(str(self.settings.redis_url), socket_connect_timeout=2)
        self._worker = Worker(
            QUEUE,
            self._handle,
            {
                "connection": str(self.settings.redis_url),
                "prefix": self.settings.queue_prefix,
                "concurrency": self.settings.concurrency,
                # El lock dura más que el job: un OCR largo no se toma por atascado.
                "lockDuration": int((self.settings.timeout_s + 30) * 1000),
            },
        )
        self._heartbeat = asyncio.create_task(self._beat())
        logger.info(
            "worker iniciado",
            extra={"worker_id": self.id, "concurrency": self.settings.concurrency},
        )

    async def stop(self) -> None:
        if self._heartbeat:
            self._heartbeat.cancel()
            self._heartbeat = None
        if self._worker and not self._worker.closing:
            await self._worker.close()
        if self._redis:
            await self.redis.delete(self._heartbeat_key)
        logger.info("worker detenido", extra={"worker_id": self.id})

    async def aclose(self) -> None:
        await self.stop()
        if self._redis:
            await self._redis.aclose()
            self._redis = None

    @property
    def _heartbeat_key(self) -> str:
        return f"{self.settings.key_prefix}detection:worker:{self.id}"

    async def _beat(self) -> None:
        while True:
            try:
                value = json.dumps({"at": datetime.now(UTC).isoformat()})
                await self.redis.set(self._heartbeat_key, value, ex=self.settings.heartbeat_ttl_s)
            except Exception as error:  # noqa: BLE001 - Redis caído: se reintenta en el siguiente latido
                logger.warning("latido fallido", extra={"error": type(error).__name__})
            await asyncio.sleep(self.settings.heartbeat_s)

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


async def _check(check: Callable[[], Awaitable[Any]]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(check(), timeout=2)
        return {"status": "up", "latencyMs": round((time.perf_counter() - started) * 1000)}
    except Exception as error:  # noqa: BLE001 - cualquier fallo marca la dependencia como caída
        return {
            "status": "down",
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "error": "timeout" if isinstance(error, TimeoutError) else type(error).__name__,
        }


def create_health_app(worker: DetectionWorker) -> FastAPI:
    """`GET /health` del worker (constitución VI): Redis responde y BullMQ sigue consumiendo."""
    app = FastAPI(title="ReqCanvas analytics-worker")

    async def ping_redis() -> None:
        # redis-py tipa `ping` como síncrono o asíncrono según el cliente.
        await cast(Awaitable[bool], worker.redis.ping())

    async def worker_alive() -> None:
        if not worker.running:
            raise RuntimeError("stopped")

    @app.get("/health")
    async def health() -> JSONResponse:
        redis, alive = await asyncio.gather(_check(ping_redis), _check(worker_alive))
        checks = {"redis": redis, "worker": alive}
        ok = all(check["status"] == "up" for check in checks.values())
        body = {
            "status": "ok" if ok else "degraded",
            "service": SERVICE,
            "version": worker.settings.app_version,
            "commit": worker.settings.git_sha,
            "checks": checks,
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        return JSONResponse(body, status_code=200 if ok else 503)

    return app


def default_processor() -> Processor:
    """El pipeline real; se importa aquí para que el worker arranque sin cargar OpenCV antes."""
    from analytics.detection.pipeline import process

    return process


async def serve(settings: WorkerSettings, process: Processor) -> None:
    worker = DetectionWorker(settings, process)
    await worker.start()
    server = uvicorn.Server(uvicorn.Config(create_health_app(worker), log_config=None))
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, lambda: setattr(server, "should_exit", True))
    try:
        await server.serve(sockets=[dual_stack_socket(settings.host, settings.port)])
    finally:
        # Cierre ordenado: el job en curso termina o se libera para otro worker.
        await worker.aclose()


def run() -> None:
    try:
        settings = WorkerSettings.model_validate(
            {key: value for key, value in os.environ.items() if value != ""}
        )
    except ValidationError as error:
        variables = sorted({str(issue["loc"][0]) for issue in error.errors()})
        record = {
            "level": "CRITICAL",
            "message": "Configuración inválida o incompleta. Revisa las variables: "
            + ", ".join(variables),
            "variables": variables,
        }
        print(json.dumps(record, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    configure_logging(settings.log_level, service=SERVICE)
    asyncio.run(serve(settings, default_processor()))


if __name__ == "__main__":
    run()
