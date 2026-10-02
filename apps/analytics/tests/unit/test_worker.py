"""Worker de la cola `detection` (feature 006, T018). Redis real, procesador simulado."""

import asyncio
import json
import os
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from bullmq import Job, Queue
from redis.asyncio import Redis

from analytics.detection.errors import DetectionError
from analytics.detection.schemas import DetectionJobInput, DetectionResult
from analytics.worker import (
    QUEUE,
    DetectionWorker,
    ProgressFn,
    WorkerSettings,
    create_health_app,
)

REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379")
EXAMPLES = Path(__file__).parents[1] / "contract" / "examples"
RESULT = json.loads((EXAMPLES / "result.json").read_text(encoding="utf-8"))
INPUT = json.loads((EXAMPLES / "input.json").read_text(encoding="utf-8"))

Process = Callable[[DetectionJobInput, ProgressFn], Awaitable[DetectionResult]]

pytestmark = pytest.mark.asyncio


def settings(**overrides: Any) -> WorkerSettings:
    suffix = uuid.uuid4().hex[:8]
    values: dict[str, Any] = {
        "REDIS_URL": REDIS_TEST_URL,
        "PORT": "0",
        "DETECTION_QUEUE_PREFIX": f"bulltest{suffix}",
        "DETECTION_KEY_PREFIX": f"test{suffix}:",
        "DETECTION_TIMEOUT_S": "5",
        "DETECTION_HEARTBEAT_S": "0.2",
    }
    values.update(overrides)
    return WorkerSettings.model_validate(values)


async def succeed(job: DetectionJobInput, progress: ProgressFn) -> DetectionResult:
    await progress("download", 10)
    await progress("ocr", 55)
    return DetectionResult.model_validate(RESULT)


class Harness:
    def __init__(self, worker: DetectionWorker, queue: Queue, config: WorkerSettings) -> None:
        self.worker, self.queue, self.config = worker, queue, config

    async def add(self, **data: Any) -> str:
        job_id = uuid.uuid4().hex[:24]
        payload = {**INPUT, "jobId": job_id, **data}
        await self.queue.add("detect", payload, {"jobId": job_id})
        return job_id

    async def finished(self, job_id: str, timeout_s: float = 8) -> Job:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            job = await self.queue.getJob(job_id)
            if job and job.finishedOn:
                return job
            await asyncio.sleep(0.05)
        raise AssertionError(f"El job {job_id} no terminó")


async def harness_for(process: Process, **overrides: Any) -> AsyncIterator[Harness]:
    config = settings(**overrides)
    worker = DetectionWorker(config, process)
    await worker.start()
    queue = Queue(QUEUE, {"connection": REDIS_TEST_URL, "prefix": config.queue_prefix})
    try:
        yield Harness(worker, queue, config)
    finally:
        await worker.stop()
        await queue.obliterate(force=True)
        await queue.close()


@pytest_asyncio.fixture
async def harness() -> AsyncIterator[Harness]:
    async for value in harness_for(succeed):
        yield value


async def test_procesa_el_job_publica_el_progreso_y_devuelve_el_resultado(
    harness: Harness,
) -> None:
    job = await harness.finished(await harness.add())
    assert job.failedReason is None
    assert job.returnvalue == RESULT
    assert job.progress == {"stage": "ocr", "pct": 55}


@pytest.mark.parametrize(
    ("raised", "code"),
    [
        (DetectionError("IMAGE_DOWNLOAD_FAILED"), "IMAGE_DOWNLOAD_FAILED"),
        (RuntimeError("detalle interno con /ruta/secreta"), "INTERNAL"),
    ],
)
async def test_falla_con_el_codigo_en_el_mensaje(raised: Exception, code: str) -> None:
    async def fail(job: DetectionJobInput, progress: ProgressFn) -> DetectionResult:
        raise raised

    async for harness in harness_for(fail):
        job = await harness.finished(await harness.add())
        assert job.failedReason == code


async def test_sin_terminar_en_el_tiempo_maximo_falla_con_timeout() -> None:
    async def slow(job: DetectionJobInput, progress: ProgressFn) -> DetectionResult:
        await asyncio.sleep(5)
        return DetectionResult.model_validate(RESULT)

    async for harness in harness_for(slow, DETECTION_TIMEOUT_S="0.3"):
        job = await harness.finished(await harness.add())
        assert job.failedReason == "TIMEOUT"


async def test_una_entrada_invalida_falla_sin_llamar_al_procesador() -> None:
    calls: list[str] = []

    async def record(job: DetectionJobInput, progress: ProgressFn) -> DetectionResult:
        calls.append(job.jobId)
        return DetectionResult.model_validate(RESULT)

    async for harness in harness_for(record):
        job = await harness.finished(await harness.add(v=2))
        assert job.failedReason == "INTERNAL"
        assert calls == []


async def test_respeta_la_concurrencia() -> None:
    active = 0
    peak = 0

    async def busy(job: DetectionJobInput, progress: ProgressFn) -> DetectionResult:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.3)
        active -= 1
        return DetectionResult.model_validate(RESULT)

    async for harness in harness_for(busy, DETECTION_CONCURRENCY="1"):
        ids = [await harness.add(), await harness.add()]
        for job_id in ids:
            await harness.finished(job_id)
        assert peak == 1


async def test_escribe_el_latido_con_ttl(harness: Harness) -> None:
    redis = Redis.from_url(REDIS_TEST_URL)
    try:
        key = f"{harness.config.key_prefix}detection:worker:{harness.worker.id}"
        deadline = time.monotonic() + 3
        while not await redis.exists(key) and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        assert await redis.exists(key)
        assert 0 < await redis.ttl(key) <= 30
    finally:
        await redis.aclose()


async def test_health_responde_200_con_el_worker_vivo_y_503_al_parar() -> None:
    async for harness in harness_for(succeed):
        app = create_health_app(harness.worker)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://worker") as client:
            alive = await client.get("/health")
            assert alive.status_code == 200
            body = alive.json()
            assert body["service"] == "analytics-worker"
            assert body["checks"]["redis"]["status"] == "up"
            assert body["checks"]["worker"]["status"] == "up"
            await harness.worker.stop()
            stopped = await client.get("/health")
            assert stopped.status_code == 503
            assert stopped.json()["checks"]["worker"]["status"] == "down"
