"""Worker de la cola `analysis` (feature 007, T016). Redis real, bucket simulado por HTTP."""

import asyncio
import gzip
import json
import os
import threading
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from bullmq import Job, Queue
from redis.asyncio import Redis

from analytics.logging import current_request_id
from analytics.mining.run import Outcome, ProgressFn
from analytics.mining.schemas import AnalysisInputFile, AnalysisJobInput, AnalysisResults
from analytics.mining.worker import (
    QUEUE,
    AnalysisWorker,
    Processor,
    WorkerSettings,
    create_health_app,
)

REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379")
EXAMPLES = Path(__file__).parents[1] / "contract" / "examples" / "analysis"


def example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text("utf-8"))
    return data


RESULTS = example("results")
INPUT_FILE = example("input-file")

pytestmark = pytest.mark.asyncio


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
                if stored is None or self.path.startswith("/forbidden"):
                    self.send_response(404 if stored is None else 403)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
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

    def put_json(self, path: str, value: Any) -> None:
        self.objects[path] = (gzip.compress(json.dumps(value).encode()), "application/gzip")

    def json(self, path: str) -> Any:
        return json.loads(gzip.decompress(self.objects[path][0]))


@pytest.fixture
def bucket() -> Iterator[Bucket]:
    server = Bucket()
    server.put_json("/run/input.json.gz", INPUT_FILE)
    server.put_json("/run/previous.json.gz", RESULTS)
    yield server
    server.server.shutdown()


def settings(**overrides: Any) -> WorkerSettings:
    suffix = uuid.uuid4().hex[:8]
    values: dict[str, Any] = {
        "REDIS_URL": REDIS_TEST_URL,
        "PORT": "0",
        "ANALYSIS_QUEUE_PREFIX": f"bulltest{suffix}",
        "ANALYSIS_KEY_PREFIX": f"test{suffix}:",
        "ANALYSIS_TIMEOUT_S": "5",
        "ANALYSIS_HEARTBEAT_S": "0.2",
    }
    values.update(overrides)
    return WorkerSettings.model_validate(values)


async def succeed(
    job: AnalysisJobInput,
    data: AnalysisInputFile,
    previous: AnalysisResults | None,
    progress: ProgressFn,
) -> Outcome:
    assert current_request_id() == job.requestId
    await progress("topics", 45)
    return Outcome(results=AnalysisResults.model_validate(RESULTS), detail_count=len(data.details))


class Harness:
    def __init__(self, worker: AnalysisWorker, queue: Queue, bucket: Bucket) -> None:
        self.worker, self.queue, self.bucket = worker, queue, bucket

    async def add(self, name: str = "job-input", **changes: Any) -> str:
        run_id = uuid.uuid4().hex[:24]
        payload = {
            **example(name),
            "runId": run_id,
            "inputUrl": f"{self.bucket.url}/run/input.json.gz?X-Amz-Signature=a",
            "resultsUrl": f"{self.bucket.url}/run/{run_id}.json.gz?X-Amz-Signature=b",
            **changes,
        }
        if payload.get("previousResultsUrl"):
            payload["previousResultsUrl"] = f"{self.bucket.url}/run/previous.json.gz?s=c"
        await self.queue.add("analyze", payload, {"jobId": run_id})
        return run_id

    async def finished(self, run_id: str, timeout_s: float = 8) -> Job:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            job = await self.queue.getJob(run_id)
            if job and job.finishedOn:
                return job
            await asyncio.sleep(0.05)
        raise AssertionError(f"El job {run_id} no terminó")


async def harness_for(
    process: Processor, bucket: Bucket, **overrides: Any
) -> AsyncIterator[Harness]:
    config = settings(**overrides)
    worker = AnalysisWorker(config, process)
    await worker.start()
    queue = Queue(QUEUE, {"connection": REDIS_TEST_URL, "prefix": config.queue_prefix})
    try:
        yield Harness(worker, queue, bucket)
    finally:
        await worker.stop()
        await queue.obliterate(force=True)
        await queue.close()


@pytest_asyncio.fixture
async def harness(bucket: Bucket) -> AsyncIterator[Harness]:
    async for value in harness_for(succeed, bucket):
        yield value


async def test_descarga_procesa_sube_los_resultados_y_devuelve_el_resumen(
    harness: Harness,
) -> None:
    run_id = await harness.add()
    job = await harness.finished(run_id)
    assert job.failedReason is None
    assert job.returnvalue == {
        "v": 1,
        "status": "done",
        "partial": False,
        "detailCount": 2,
        "stages": RESULTS["stages"],
    }
    assert job.progress == {"stage": "upload", "pct": 100}
    assert harness.bucket.objects[f"/run/{run_id}.json.gz"][1] == "application/gzip"
    uploaded = AnalysisResults.model_validate(harness.bucket.json(f"/run/{run_id}.json.gz"))
    assert uploaded == AnalysisResults.model_validate(RESULTS)


async def test_una_etapa_fallida_marca_el_resumen_como_parcial(bucket: Bucket) -> None:
    async def partial(
        job: AnalysisJobInput,
        data: AnalysisInputFile,
        previous: AnalysisResults | None,
        progress: ProgressFn,
    ) -> Outcome:
        stages = {**RESULTS["stages"], "sentiment": {"status": "failed", "error": "OSError"}}
        results = AnalysisResults.model_validate({**RESULTS, "stages": stages, "sentiment": None})
        return Outcome(results=results, detail_count=2)

    async for harness in harness_for(partial, bucket):
        job = await harness.finished(await harness.add())
        assert job.returnvalue["status"] == "done"
        assert job.returnvalue["partial"] is True
        assert job.returnvalue["stages"]["sentiment"] == {"status": "failed", "error": "OSError"}


async def test_regenerar_insights_recibe_los_resultados_anteriores(bucket: Bucket) -> None:
    received: list[AnalysisResults | None] = []

    async def remember(
        job: AnalysisJobInput,
        data: AnalysisInputFile,
        previous: AnalysisResults | None,
        progress: ProgressFn,
    ) -> Outcome:
        received.append(previous)
        return Outcome(results=AnalysisResults.model_validate(RESULTS), detail_count=2)

    async for harness in harness_for(remember, bucket):
        job = await harness.finished(await harness.add("job-input-insights"))
        assert job.returnvalue["status"] == "done"
        assert received == [AnalysisResults.model_validate(RESULTS)]


async def raise_runtime(
    job: AnalysisJobInput,
    data: AnalysisInputFile,
    previous: AnalysisResults | None,
    progress: ProgressFn,
) -> Outcome:
    raise RuntimeError("detalle interno con /ruta/secreta")


async def hang(
    job: AnalysisJobInput,
    data: AnalysisInputFile,
    previous: AnalysisResults | None,
    progress: ProgressFn,
) -> Outcome:
    await asyncio.sleep(10)
    raise AssertionError("no debería llegar")


@pytest.mark.parametrize(
    ("process", "changes", "code"),
    [
        (succeed, {"v": 2}, "INVALID_JOB"),
        (succeed, {"inputUrl": "http://127.0.0.1:9/nada.json.gz"}, "INPUT_DOWNLOAD_FAILED"),
        (succeed, {"resultsUrl": "BUCKET/forbidden/results.json.gz"}, "RESULTS_UPLOAD_FAILED"),
        (raise_runtime, {}, "INTERNAL"),
        (hang, {}, "TIMEOUT"),
    ],
)
async def test_los_errores_previstos_terminan_failed_con_un_codigo(
    bucket: Bucket, process: Processor, changes: dict[str, Any], code: str
) -> None:
    async for harness in harness_for(process, bucket, ANALYSIS_TIMEOUT_S="1"):
        resolved = {
            key: value.replace("BUCKET", bucket.url) if isinstance(value, str) else value
            for key, value in changes.items()
        }
        job = await harness.finished(await harness.add(**resolved))
        assert job.returnvalue == {
            "v": 1,
            "status": "failed",
            "partial": False,
            "detailCount": 0,
            "stages": {},
            "error": {"code": code},
        }


async def test_una_entrada_que_no_cumple_el_contrato_termina_invalid_input(
    bucket: Bucket,
) -> None:
    bucket.put_json("/run/input.json.gz", {**INPUT_FILE, "v": 9})
    async for harness in harness_for(succeed, bucket):
        job = await harness.finished(await harness.add())
        assert job.returnvalue["error"] == {"code": "INVALID_INPUT"}


async def test_latido_en_redis_y_health(harness: Harness) -> None:
    redis = Redis.from_url(REDIS_TEST_URL)
    try:
        config = harness.worker.settings
        key = f"{config.key_prefix}analysis:worker:{harness.worker.id}"
        deadline = time.monotonic() + 3
        while not await redis.exists(key):
            assert time.monotonic() < deadline, "sin latido"
            await asyncio.sleep(0.05)
        transport = httpx.ASGITransport(app=create_health_app(harness.worker))
        async with httpx.AsyncClient(transport=transport, base_url="http://worker") as client:
            response = await client.get("/health")
            assert response.status_code == 200
            body = response.json()
            assert body["service"] == "analysis-worker"
            assert body["checks"]["worker"]["status"] == "up"
        await harness.worker.stop()
        assert not await redis.exists(key)
    finally:
        await redis.aclose()
