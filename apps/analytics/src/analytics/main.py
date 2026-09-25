import json
import socket
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from pymongo import AsyncMongoClient
from redis.asyncio import Redis

from analytics.config import ConfigError, Settings, load_settings
from analytics.logging import RequestIdMiddleware, configure_logging
from analytics.routes import health


def create_app(settings: Settings | None = None, check_timeout_s: float = 2.0) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        timeout_ms = int(check_timeout_s * 1000)
        app.state.mongo = AsyncMongoClient(settings.mongo_url, serverSelectionTimeoutMS=timeout_ms)
        app.state.redis = Redis.from_url(
            str(settings.redis_url), socket_connect_timeout=check_timeout_s
        )
        try:
            yield
        finally:
            await app.state.mongo.close()
            await app.state.redis.aclose()

    app = FastAPI(title="ReqCanvas analytics", lifespan=lifespan)
    app.state.settings = settings
    app.state.check_timeout_s = check_timeout_s
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    return app


def dual_stack_socket(host: str, port: int) -> socket.socket:
    """Socket de escucha. Con `::` acepta IPv6 e IPv4 (IPV6_V6ONLY=0), como Node en `::`.

    asyncio activa IPV6_V6ONLY por defecto; sin esto el servicio no respondería por IPv4
    (p. ej., el mapeo de puertos de Docker), solo por la red privada IPv6 de Railway.
    """
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if family == socket.AF_INET6:
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind((host, port))
    return sock


def run() -> None:
    """Punto de entrada del contenedor: valida la configuración y arranca uvicorn."""
    try:
        settings = load_settings()
    except ConfigError as error:
        record = {"level": "CRITICAL", "message": str(error), "variables": error.variables}
        print(json.dumps(record, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    configure_logging(settings.log_level)
    server = uvicorn.Server(uvicorn.Config(create_app(settings), log_config=None))
    server.run(sockets=[dual_stack_socket(settings.host, settings.port)])


if __name__ == "__main__":
    run()
