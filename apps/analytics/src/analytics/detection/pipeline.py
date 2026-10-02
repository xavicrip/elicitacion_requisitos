"""Pipeline de la detección (research R3–R6): formas → texto → flechas → resultado del contrato."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from analytics.detection.errors import DetectionError
from analytics.detection.ocr import read_label
from analytics.detection.preprocess import Image8, UnreadableImageError, decode, downscale
from analytics.detection.schemas import (
    BBox,
    DetectedActivity,
    DetectionJobInput,
    DetectionResult,
    DetectionStats,
    Flag,
    Stage,
)
from analytics.detection.shapes import Shape, detect_shapes

DOWNLOAD_TIMEOUT_S = 30


@dataclass(frozen=True)
class DetectionOptions:
    llm_refine: bool = False
    arrows: bool = True
    languages: tuple[str, ...] = ("spa", "eng")


Report = Callable[[Stage, int], None]


def _bbox(shape: Shape, width: int, height: int) -> BBox:
    box = shape.box
    x, y = box.x / width, box.y / height
    return BBox(
        x=round(x, 5),
        y=round(y, 5),
        w=round(min(box.w / width, 1 - x), 5),
        h=round(min(box.h / height, 1 - y), 5),
    )


def confidence(shape: Shape, label: str, ocr: float) -> float:
    """0,6 × ajuste geométrico + 0,4 × confianza del OCR; sin texto que leer (inicio, fin y
    decisiones sin nombre), solo la geométrica. Una acción sin nombre legible baja de nivel."""
    if shape.type in ("start", "end") or (shape.type == "decision" and not label):
        return round(shape.geometry, 3)
    return round(0.6 * shape.geometry + 0.4 * (ocr if label else 0.0), 3)


def detect(
    image: Image8, options: DetectionOptions, report: Report | None = None
) -> DetectionResult:
    """Detección sobre una imagen ya descargada (síncrona: la usan el worker y la evaluación)."""
    started = time.perf_counter()
    notify = report or (lambda stage, pct: None)
    work, _ = downscale(image)
    height, width = work.shape[:2]

    notify("shapes", 15)
    shapes = detect_shapes(work)

    notify("ocr", 35)
    activities: list[DetectedActivity] = []
    readings: list[float] = []
    for index, shape in enumerate(shapes):
        label, ocr = "", 0.0
        if shape.type in ("action", "decision"):
            reading = read_label(work, shape.interior, options.languages, shape.outline)
            label, ocr = reading.text, reading.confidence
            if reading.text:
                readings.append(reading.confidence)
        flags: list[Flag] = ["empty_label"] if shape.type == "action" and not label else []
        activities.append(
            DetectedActivity(
                tempId=f"a{index + 1}",
                bbox=_bbox(shape, width, height),
                type=shape.type,
                label=label,
                confidence=confidence(shape, label, ocr),
                flags=flags,
            )
        )
        notify("ocr", 35 + round(50 * (index + 1) / max(1, len(shapes))))

    return DetectionResult(
        activities=activities,
        transitions=[],
        stats=DetectionStats(
            durationMs=round((time.perf_counter() - started) * 1000),
            llmUsed=False,
            ocrMeanConfidence=round(sum(readings) / len(readings), 3) if readings else None,
        ),
    )


async def _coroutine(awaitable: Awaitable[None]) -> None:
    await awaitable


async def download(url: str) -> bytes:
    try:
        async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT_S) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.content
    except httpx.HTTPError:
        raise DetectionError("IMAGE_DOWNLOAD_FAILED") from None


async def process(
    job: DetectionJobInput, progress: Callable[[Stage, int], Awaitable[None]]
) -> DetectionResult:
    """Procesador del worker: descarga la imagen firmada y ejecuta el pipeline en un hilo."""
    await progress("download", 5)
    data = await download(str(job.image.url))
    try:
        image = decode(data)
    except UnreadableImageError:
        raise DetectionError("IMAGE_DOWNLOAD_FAILED") from None

    loop = asyncio.get_running_loop()

    def report(stage: Stage, pct: int) -> None:
        # Desde el hilo del pipeline: el progreso se publica en el bucle del worker.
        asyncio.run_coroutine_threadsafe(_coroutine(progress(stage, pct)), loop)

    options = DetectionOptions(
        llm_refine=job.options.llmRefine,
        arrows=job.options.arrows,
        languages=tuple(job.options.languages),
    )
    return await asyncio.to_thread(detect, image, options, report)
