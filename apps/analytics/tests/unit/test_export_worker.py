"""Worker de la cola `export` (feature 008, T036). Redis real, bucket simulado por HTTP."""

import asyncio
import gzip
import io
import json
import logging
import os
import threading
import time
import uuid
from collections.abc import AsyncIterator, Iterator, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from bullmq import Job, Queue
from PIL import Image
from redis.asyncio import Redis

from analytics.detection.schemas import DetectionJobInput, DetectionResult
from analytics.logging import current_request_id
from analytics.reports.pdf import Report
from analytics.reports.schemas import ExportInputFile
from analytics.reports.worker import QUEUE, ExportWorker, Renderer
from analytics.worker import (
    DetectionWorker,
    ProgressFn,
    WorkerSettings,
    create_health_app,
    default_renderer,
    export_worker,
)

REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379")
EXAMPLES = Path(__file__).parents[1] / "contract" / "examples" / "export"
DIAGRAM_ID = "66f100000000000000000001"
PDF = b"%PDF-1.7 reporte de prueba"

pytestmark = pytest.mark.asyncio


def example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text("utf-8"))
    return data


class Bucket:
    """Servidor HTTP que hace de bucket: guarda los PUT y sirve los GET; `/forbidden` → 403."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        bucket = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                stored = bucket.objects.get(self.path.split("?")[0])
                self.send_response(200 if stored else 404)
                self.end_headers()
                if stored:
                    self.wfile.write(stored[0])

            def do_PUT(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers["content-length"]))
                if self.path.startswith("/forbidden"):
                    self.send_response(403)
                    self.end_headers()
                    return
                bucket.objects[self.path.split("?")[0]] = (body, self.headers["content-type"])
                self.send_response(200)
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def put_input(self, data: dict[str, Any]) -> None:
        self.objects["/export/input.json.gz"] = (
            gzip.compress(json.dumps(data).encode()),
            "application/gzip",
        )


def diagram_image() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (320, 180), (255, 255, 255)).save(output, format="WEBP")
    return output.getvalue()


@pytest.fixture
def bucket() -> Iterator[Bucket]:
    server = Bucket()
    data = example("input-file")
    data["diagrams"][0]["image"]["url"] = f"{server.url}/diagram/display.webp?X-Amz-Signature=i"
    server.put_input(data)
    server.objects["/diagram/display.webp"] = (diagram_image(), "image/webp")
    yield server
    server.server.shutdown()


def settings(**overrides: Any) -> WorkerSettings:
    suffix = uuid.uuid4().hex[:8]
    values: dict[str, Any] = {
        "REDIS_URL": REDIS_TEST_URL,
        "PORT": "0",
        "DETECTION_QUEUE_PREFIX": f"bulltest{suffix}",
        "DETECTION_KEY_PREFIX": f"test{suffix}:",
        "DETECTION_HEARTBEAT_S": "0.2",
        "EXPORT_TIMEOUT_S": "5",
    }
    values.update(overrides)
    return WorkerSettings.model_validate(values)


class Harness:
    def __init__(self, worker: ExportWorker, queue: Queue, bucket: Bucket) -> None:
        self.worker, self.queue, self.bucket = worker, queue, bucket

    async def add(self, **changes: Any) -> str:
        export_id = uuid.uuid4().hex[:24]
        payload = {
            **example("job-input"),
            "exportId": export_id,
            "inputUrl": f"{self.bucket.url}/export/input.json.gz?X-Amz-Signature=a",
            "outputUrl": f"{self.bucket.url}/export/{export_id}.pdf?X-Amz-Signature=b",
            **changes,
        }
        await self.queue.add("export", payload, {"jobId": export_id})
        return export_id

    async def finished(self, export_id: str, timeout_s: float = 20) -> Job:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            job = await self.queue.getJob(export_id)
            if job and job.finishedOn:
                return job
            await asyncio.sleep(0.05)
        raise AssertionError(f"El job {export_id} no terminó")


async def harness_for(render: Renderer, bucket: Bucket, **overrides: Any) -> AsyncIterator[Harness]:
    config = settings(**overrides)
    worker = export_worker(config, render)
    await worker.start()
    queue = Queue(QUEUE, {"connection": REDIS_TEST_URL, "prefix": config.queue_prefix})
    try:
        yield Harness(worker, queue, bucket)
    finally:
        await worker.aclose()
        await queue.obliterate(force=True)
        await queue.close()


received: list[tuple[ExportInputFile, Mapping[str, bytes | None], str | None]] = []


def fake(data: ExportInputFile, images: Mapping[str, bytes | None]) -> Report:
    received.append((data, images, current_request_id()))
    return Report(pdf=PDF, pages=3)


@pytest_asyncio.fixture
async def harness(bucket: Bucket) -> AsyncIterator[Harness]:
    received.clear()
    async for value in harness_for(fake, bucket):
        yield value


async def test_descarga_la_entrada_sube_el_pdf_y_devuelve_el_resumen(
    harness: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="analytics.reports.worker")
    export_id = await harness.add()
    job = await harness.finished(export_id)
    assert job.failedReason is None
    assert job.returnvalue == {"v": 1, "status": "done", "bytes": len(PDF), "pages": 3}
    assert harness.bucket.objects[f"/export/{export_id}.pdf"] == (PDF, "application/pdf")

    data, images, request_id = received[0]
    assert data.project.name == "Tienda demo"
    assert images == {DIAGRAM_ID: diagram_image()}
    assert request_id == example("job-input")["requestId"]

    # El log de fin lleva la duración, el tamaño y las páginas (constitución VI).
    done = next(record for record in caplog.records if record.message == "reporte terminado")
    assert done.__dict__["export_id"] == export_id
    assert done.__dict__["bytes"] == len(PDF)
    assert done.__dict__["pages"] == 3
    assert done.__dict__["duration_ms"] >= 0


async def test_sin_la_imagen_de_un_diagrama_el_reporte_se_genera_igual(harness: Harness) -> None:
    del harness.bucket.objects["/diagram/display.webp"]
    job = await harness.finished(await harness.add())
    assert job.returnvalue["status"] == "done"
    assert received[0][1] == {DIAGRAM_ID: None}


async def test_con_el_generador_real_sube_un_pdf(bucket: Bucket) -> None:
    async for harness in harness_for(default_renderer(), bucket, EXPORT_TIMEOUT_S="60"):
        export_id = await harness.add()
        job = await harness.finished(export_id, timeout_s=60)
        pdf = bucket.objects[f"/export/{export_id}.pdf"][0]
        assert pdf.startswith(b"%PDF")
        assert job.returnvalue == {"v": 1, "status": "done", "bytes": len(pdf), "pages": 6}


def broken(data: ExportInputFile, images: Mapping[str, bytes | None]) -> Report:
    raise RuntimeError("detalle interno con /ruta/secreta")


def slow(data: ExportInputFile, images: Mapping[str, bytes | None]) -> Report:
    time.sleep(1.5)
    return Report(pdf=PDF, pages=1)


@pytest.mark.parametrize(
    ("render", "changes", "code", "message"),
    [
        (fake, {"v": 2}, "EXPORT_FAILED", "No se pudo generar el reporte."),
        (
            fake,
            {"inputUrl": "http://127.0.0.1:9/nada.json.gz"},
            "INPUT_DOWNLOAD_FAILED",
            "No se pudo leer la entrada del reporte.",
        ),
        (
            fake,
            {"outputUrl": "BUCKET/forbidden/reporte.pdf"},
            "OUTPUT_UPLOAD_FAILED",
            "No se pudo guardar el reporte.",
        ),
        (broken, {}, "EXPORT_FAILED", "No se pudo generar el reporte."),
        (slow, {}, "TIMEOUT", "El reporte tardó demasiado en generarse."),
    ],
)
async def test_los_errores_previstos_terminan_failed_con_un_codigo(
    bucket: Bucket, render: Renderer, changes: dict[str, Any], code: str, message: str
) -> None:
    async for harness in harness_for(render, bucket, EXPORT_TIMEOUT_S="0.5"):
        resolved = {
            key: value.replace("BUCKET", bucket.url) if isinstance(value, str) else value
            for key, value in changes.items()
        }
        export_id = await harness.add(**resolved)
        job = await harness.finished(export_id)
        assert job.returnvalue == {
            "v": 1,
            "status": "failed",
            "error": {"code": code, "message": message},
        }
        assert f"/export/{export_id}.pdf" not in bucket.objects


async def test_una_entrada_que_no_cumple_el_contrato_termina_failed(bucket: Bucket) -> None:
    bucket.put_input({**example("input-file"), "schemaVersion": 9})
    async for harness in harness_for(fake, bucket):
        job = await harness.finished(await harness.add())
        assert job.returnvalue["error"]["code"] == "INPUT_DOWNLOAD_FAILED"


async def test_el_proceso_consume_las_dos_colas_con_un_latido_por_cola() -> None:
    async def detect(job: DetectionJobInput, progress: ProgressFn) -> DetectionResult:
        raise AssertionError("sin jobs de detección en esta prueba")

    config = settings()
    detection = DetectionWorker(config, detect)
    exports = export_worker(config, fake)
    await detection.start()
    await exports.start()
    redis = Redis.from_url(REDIS_TEST_URL)
    try:
        keys = [
            f"{config.key_prefix}detection:worker:{detection.id}",
            f"{config.key_prefix}export:worker:{exports.id}",
        ]
        deadline = time.monotonic() + 3
        while not all([await redis.exists(key) for key in keys]):
            assert time.monotonic() < deadline, "sin latido"
            await asyncio.sleep(0.05)
        assert 0 < await redis.ttl(keys[1]) <= 30

        transport = httpx.ASGITransport(app=create_health_app(detection, exports))
        async with httpx.AsyncClient(transport=transport, base_url="http://worker") as client:
            alive = await client.get("/health")
            assert alive.status_code == 200
            checks = alive.json()["checks"]
            assert {name: check["status"] for name, check in checks.items()} == {
                "redis": "up",
                "worker": "up",
                "export-worker": "up",
            }
            await exports.stop()
            stopped = await client.get("/health")
            assert stopped.status_code == 503
            assert stopped.json()["checks"]["export-worker"]["status"] == "down"
            assert stopped.json()["checks"]["worker"]["status"] == "up"
        assert not await redis.exists(keys[1])
    finally:
        await redis.aclose()
        await exports.aclose()
        await detection.aclose()
