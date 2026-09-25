"""GET /health y GET /version (specs/001-plataforma-base/contracts/health.openapi.yaml)."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


async def _run_check(check: Callable[[], Awaitable[Any]], timeout_s: float) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(check(), timeout=timeout_s)
        return {"status": "up", "latencyMs": round((time.perf_counter() - started) * 1000)}
    except Exception as error:  # noqa: BLE001 - cualquier fallo marca la dependencia como caída
        return {
            "status": "down",
            "latencyMs": round((time.perf_counter() - started) * 1000),
            # Solo el tipo de error: los mensajes pueden incluir hosts internos.
            "error": "timeout" if isinstance(error, TimeoutError) else type(error).__name__,
        }


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    state = request.app.state
    mongo, redis = await asyncio.gather(
        _run_check(lambda: state.mongo.admin.command("ping"), state.check_timeout_s),
        _run_check(lambda: state.redis.ping(), state.check_timeout_s),
    )
    checks = {"mongo": mongo, "redis": redis}
    ok = all(check["status"] == "up" for check in checks.values())
    body = {
        "status": "ok" if ok else "degraded",
        "service": "analytics",
        "version": state.settings.app_version,
        "commit": state.settings.git_sha,
        "checks": checks,
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    return JSONResponse(body, status_code=200 if ok else 503)


@router.get("/version")
async def version(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    return {"service": "analytics", "version": settings.app_version, "commit": settings.git_sha}
