from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pymongo import AsyncMongoClient
from redis.asyncio import Redis

from analytics.config import Settings, load_settings
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


def run() -> None:
    """Punto de entrada del contenedor: valida la configuración y arranca uvicorn."""
    import json
    import sys

    import uvicorn

    from analytics.config import ConfigError

    try:
        settings = load_settings()
    except ConfigError as error:
        record = {"level": "CRITICAL", "message": str(error), "variables": error.variables}
        print(json.dumps(record, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    configure_logging(settings.log_level)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_config=None)


if __name__ == "__main__":
    run()
