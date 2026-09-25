"""Logs JSON con `request_id` propagado (research.md R5)."""

import logging
import os
import re
import sys
import time
from contextvars import ContextVar
from typing import IO

from pythonjsonlogger.json import JsonFormatter
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "x-request-id"
_VALID_REQUEST_ID = re.compile(r"^[\w.-]{1,64}$")
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

logger = logging.getLogger("analytics.http")


def uuid7() -> str:
    """UUID v7 (ordenado por tiempo), igual que el que genera la API."""
    value = (time.time_ns() // 1_000_000) << 80 | int.from_bytes(os.urandom(10), "big")
    value = (value & ~(0xF << 76)) | (0x7 << 76)  # versión 7
    value = (value & ~(0x3 << 62)) | (0x2 << 62)  # variante RFC 4122
    h = f"{value:032x}"
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def current_request_id() -> str | None:
    return _request_id.get()


class _ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        record.service = "analytics"
        return True


def configure_logging(level: str = "INFO", stream: IO[str] | None = None) -> None:
    """Configura el logger raíz para emitir JSON a stdout (o al stream indicado)."""
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(
        JsonFormatter(
            "{levelname}{name}{message}{request_id}{service}",
            style="{",
            rename_fields={"levelname": "level", "name": "logger"},
        )
    )
    handler.addFilter(_ContextFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


class RequestIdMiddleware:
    """Middleware ASGI: reutiliza o genera `x-request-id`, lo devuelve y lo registra."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = next(
            (v.decode() for k, v in scope["headers"] if k.decode().lower() == REQUEST_ID_HEADER),
            None,
        )
        request_id = incoming if incoming and _VALID_REQUEST_ID.match(incoming) else uuid7()
        token = _request_id.set(request_id)
        started = time.perf_counter()
        status = 500

        async def send_with_header(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            logger.info(
                "request completed",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            _request_id.reset(token)
