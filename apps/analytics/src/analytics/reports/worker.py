"""Worker de la cola `export` (feature 008, contracts/export-job.md): el reporte PDF.

Lo consume el proceso `analytics-worker` junto a la cola `detection` (plan, ajuste 5). No accede
a MongoDB ni tiene credenciales del bucket: descarga la entrada y las imágenes de los diagramas
por URLs firmadas, genera el PDF y lo sube por otra. Los errores previstos terminan el job con
`status: failed` y un código; el detalle solo va al log.
"""

import asyncio
import gzip
import json
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx
from bullmq import Job
from pydantic import ValidationError

from analytics.logging import bind_request_id, reset_request_id
from analytics.queue_worker import QueueOptions, QueueWorker
from analytics.reports.pdf import Report
from analytics.reports.schemas import ExportError as ErrorBody
from analytics.reports.schemas import ExportInputFile, ExportJobInput, ExportJobReturn

QUEUE = "export"
TRANSFER_TIMEOUT_S = 60

MESSAGES = {
    "INPUT_DOWNLOAD_FAILED": "No se pudo leer la entrada del reporte.",
    "OUTPUT_UPLOAD_FAILED": "No se pudo guardar el reporte.",
    "EXPORT_FAILED": "No se pudo generar el reporte.",
    "TIMEOUT": "El reporte tardó demasiado en generarse.",
}

logger = logging.getLogger("analytics.reports.worker")

Renderer = Callable[[ExportInputFile, Mapping[str, bytes | None]], Report]


class ExportError(Exception):
    """Fallo previsto de la exportación; el código es lo único que llega a `api`."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ExportOptions:
    redis_url: str
    queue_prefix: str
    key_prefix: str
    timeout_s: float
    heartbeat_s: float
    heartbeat_ttl_s: int


def _failed(code: str) -> dict[str, Any]:
    summary = ExportJobReturn(status="failed", error=ErrorBody(code=code, message=MESSAGES[code]))
    return summary.model_dump(mode="json", exclude_none=True)


class ExportWorker(QueueWorker):
    def __init__(self, options: ExportOptions, render: Renderer) -> None:
        super().__init__(
            QueueOptions(
                queue=QUEUE,
                redis_url=options.redis_url,
                queue_prefix=options.queue_prefix,
                heartbeat_key=f"{options.key_prefix}export:worker",
                concurrency=1,
                lock_ms=int((options.timeout_s + 60) * 1000),
                heartbeat_s=options.heartbeat_s,
                heartbeat_ttl_s=options.heartbeat_ttl_s,
            ),
            self._handle,
        )
        self.timeout_s = options.timeout_s
        self.render = render

    async def _handle(self, job: Job, token: str) -> dict[str, Any]:
        try:
            payload = ExportJobInput.model_validate(job.data)
        except ValidationError:
            logger.error("entrada del job inválida", extra={"job_id": job.id})
            return _failed("EXPORT_FAILED")

        request_token = bind_request_id(payload.requestId)
        extra = {"export_id": payload.exportId, "project_id": payload.projectId}
        started = time.perf_counter()
        try:
            logger.info("reporte iniciado", extra=extra)
            report = await asyncio.wait_for(self._run(payload), timeout=self.timeout_s)
            logger.info(
                "reporte terminado",
                extra={
                    **extra,
                    "bytes": len(report.pdf),
                    "pages": report.pages,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                },
            )
            summary = ExportJobReturn(status="done", bytes=len(report.pdf), pages=report.pages)
            return summary.model_dump(mode="json", exclude_none=True)
        except TimeoutError:
            logger.warning("reporte con error", extra={**extra, "code": "TIMEOUT"})
            return _failed("TIMEOUT")
        except ExportError as error:
            logger.warning("reporte con error", extra={**extra, "code": error.code})
            return _failed(error.code)
        except Exception as error:
            # El detalle solo va al log; el job termina con un código genérico.
            logger.exception("reporte fallido", extra={**extra, "error": type(error).__name__})
            return _failed("EXPORT_FAILED")
        finally:
            reset_request_id(request_token)

    async def _run(self, payload: ExportJobInput) -> Report:
        async with httpx.AsyncClient(timeout=TRANSFER_TIMEOUT_S) as client:
            try:
                response = await client.get(str(payload.inputUrl))
                response.raise_for_status()
                data = ExportInputFile.model_validate(json.loads(gzip.decompress(response.content)))
            except (httpx.HTTPError, OSError, ValueError):
                raise ExportError("INPUT_DOWNLOAD_FAILED") from None

            images: dict[str, bytes | None] = {}
            for diagram in data.diagrams:
                try:
                    image = await client.get(str(diagram.image.url))
                    image.raise_for_status()
                    images[diagram.id] = image.content
                except httpx.HTTPError:
                    # Sin la imagen el reporte se genera igual, con un marcador.
                    logger.warning("imagen del diagrama no disponible", extra={"id": diagram.id})
                    images[diagram.id] = None

            # WeasyPrint es síncrono: en un hilo, para no parar el latido ni la otra cola.
            report = await asyncio.to_thread(self.render, data, images)

            try:
                upload = await client.put(
                    str(payload.outputUrl),
                    content=report.pdf,
                    headers={"content-type": "application/pdf"},
                )
                upload.raise_for_status()
            except httpx.HTTPError:
                raise ExportError("OUTPUT_UPLOAD_FAILED") from None
        return report
