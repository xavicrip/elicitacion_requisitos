"""Infraestructura común de los workers de BullMQ (features 006 y 007).

Cada worker es un proceso aparte que consume una cola que encola `api`, escribe un latido en
Redis que `api /health/deep` comprueba y expone `GET /health` para el healthcheck de Railway
(constitución VI). Lo propio de cada cola (validar la entrada, procesar, devolver) está en su
manejador.
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
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import uvicorn
from bullmq import Job, Worker
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from redis.asyncio import Redis

from analytics.main import dual_stack_socket

logger = logging.getLogger("analytics.queue_worker")

JobHandler = Callable[[Job, str], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class QueueOptions:
    queue: str
    redis_url: str
    queue_prefix: str
    #: Clave del latido sin el sufijo del worker (p. ej. `detection:worker`).
    heartbeat_key: str
    concurrency: int
    #: El lock dura más que el job: un trabajo largo no se toma por atascado.
    lock_ms: int
    heartbeat_s: float
    heartbeat_ttl_s: int


class QueueWorker:
    def __init__(self, options: QueueOptions, handler: JobHandler) -> None:
        self.options = options
        self.handler = handler
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

    @property
    def heartbeat_key(self) -> str:
        return f"{self.options.heartbeat_key}:{self.id}"

    async def start(self) -> None:
        self._redis = Redis.from_url(self.options.redis_url, socket_connect_timeout=2)
        self._worker = Worker(
            self.options.queue,
            self.handler,
            {
                "connection": self.options.redis_url,
                "prefix": self.options.queue_prefix,
                "concurrency": self.options.concurrency,
                "lockDuration": self.options.lock_ms,
            },
        )
        self._heartbeat = asyncio.create_task(self._beat())
        logger.info(
            "worker iniciado",
            extra={
                "worker_id": self.id,
                "queue": self.options.queue,
                "concurrency": self.options.concurrency,
            },
        )

    async def stop(self) -> None:
        if self._heartbeat:
            self._heartbeat.cancel()
            self._heartbeat = None
        if self._worker and not self._worker.closing:
            await self._worker.close()
        if self._redis:
            await self.redis.delete(self.heartbeat_key)
        logger.info("worker detenido", extra={"worker_id": self.id, "queue": self.options.queue})

    async def aclose(self) -> None:
        await self.stop()
        if self._redis:
            await self._redis.aclose()
            self._redis = None

    async def _beat(self) -> None:
        while True:
            try:
                value = json.dumps({"at": datetime.now(UTC).isoformat()})
                await self.redis.set(self.heartbeat_key, value, ex=self.options.heartbeat_ttl_s)
            except Exception as error:  # noqa: BLE001 - Redis caído: se reintenta en el siguiente latido
                logger.warning("latido fallido", extra={"error": type(error).__name__})
            await asyncio.sleep(self.options.heartbeat_s)


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


def create_health_app(worker: QueueWorker, service: str, version: str, commit: str) -> FastAPI:
    """`GET /health` del worker (constitución VI): Redis responde y BullMQ sigue consumiendo."""
    app = FastAPI(title=f"ReqCanvas {service}")

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
            "service": service,
            "version": version,
            "commit": commit,
            "checks": checks,
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        return JSONResponse(body, status_code=200 if ok else 503)

    return app


async def serve(worker: QueueWorker, app: FastAPI, host: str, port: int) -> None:
    """Arranca el worker y su `/health`; al recibir SIGTERM cierra de forma ordenada."""
    await worker.start()
    server = uvicorn.Server(uvicorn.Config(app, log_config=None))
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, lambda: setattr(server, "should_exit", True))
    try:
        await server.serve(sockets=[dual_stack_socket(host, port)])
    finally:
        # Cierre ordenado: el job en curso termina o se libera para otro worker.
        await worker.aclose()


def load_settings[S: BaseModel](settings_type: type[S]) -> S:
    """Lee la configuración del entorno o termina con un log claro de las variables que faltan."""
    try:
        return settings_type.model_validate(
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
