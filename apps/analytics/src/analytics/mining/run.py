"""Orquestador del análisis (feature 007, research R11).

Ejecuta las etapas pedidas en orden, informa el progreso y aísla los fallos: una técnica que
falla queda `failed` y las demás siguen (resultados parciales). Con menos de 20 detalles solo se
ejecutan las técnicas que no necesitan volumen. Cada técnica es una función registrada en
`TECHNIQUES` que recibe el contexto y devuelve su sección de los resultados.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from analytics.mining.schemas import (
    AnalysisInputFile,
    AnalysisJobInput,
    AnalysisResults,
    ProgressStage,
    Stage,
    StageResult,
)

logger = logging.getLogger("analytics.mining")

MIN_DETAILS = 20
#: Técnicas que tienen sentido con pocos detalles (spec, US2-5).
WITHOUT_MINIMUM: frozenset[Stage] = frozenset({"keywords", "quality", "hotcold"})


@dataclass
class Context:
    job: AnalysisJobInput
    data: AnalysisInputFile
    #: Resultados del run original cuando solo se regeneran los insights.
    previous: AnalysisResults | None
    #: Lo que una etapa calcula para las siguientes (textos preprocesados, embeddings…).
    shared: dict[str, Any] = field(default_factory=dict)
    #: Secciones extra de los resultados (p. ej. `preprocess`).
    extra: dict[str, Any] = field(default_factory=dict)
    #: Secciones ya calculadas (o las del run original al regenerar insights).
    sections: dict[str, Any] = field(default_factory=dict)


class SkipStage(Exception):  # noqa: N818 - no es un error: la etapa no aplica
    """Una técnica decide que su etapa no aplica (p. ej. sin clave del modelo)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Outcome:
    results: AnalysisResults
    detail_count: int

    @property
    def partial(self) -> bool:
        return any(stage.status == "failed" for stage in self.results.stages.values())


Technique = Callable[[Context], Any]
ProgressFn = Callable[[ProgressStage, int], Awaitable[None]]

#: Técnicas disponibles; cada módulo de `analytics.mining` registra la suya.
TECHNIQUES: dict[Stage, Technique] = {}


def _skip_reason(
    stage: Stage, context: Context, techniques: Mapping[Stage, Technique]
) -> str | None:
    if len(context.data.details) < MIN_DETAILS and stage not in WITHOUT_MINIMUM:
        return "INSUFFICIENT_DATA"
    if stage == "insights" and not context.job.settings.insightsEnabled:
        return "DISABLED"
    if stage not in techniques:
        return "UNAVAILABLE"
    return None


async def process(
    job: AnalysisJobInput,
    data: AnalysisInputFile,
    previous: AnalysisResults | None,
    progress: ProgressFn,
    techniques: Mapping[Stage, Technique] | None = None,
) -> Outcome:
    available = TECHNIQUES if techniques is None else techniques
    context = Context(job=job, data=data, previous=previous)
    sections = context.sections
    stages: dict[Stage, StageResult] = {}
    if previous is not None:
        # Regenerar insights: se conservan las demás secciones del run original.
        sections.update(previous.model_dump(mode="json", by_alias=True, exclude_unset=True))
        stages = dict(previous.stages)

    for index, stage in enumerate(job.stages):
        await progress(stage, round(100 * index / len(job.stages)))
        reason = _skip_reason(stage, context, available)
        if reason is not None:
            stages[stage] = StageResult(status="skipped", reason=reason)
            sections.pop(stage, None)
            continue
        started = time.perf_counter()
        try:
            value = await asyncio.to_thread(available[stage], context)
        except SkipStage as skip:
            stages[stage] = StageResult(status="skipped", reason=skip.reason)
            sections.pop(stage, None)
            continue
        except Exception as error:  # noqa: BLE001 - una técnica fallida no detiene el análisis
            duration = round((time.perf_counter() - started) * 1000)
            logger.exception(
                "etapa fallida",
                extra={"stage": stage, "duration_ms": duration, "error": type(error).__name__},
            )
            stages[stage] = StageResult(
                status="failed", durationMs=duration, error=type(error).__name__
            )
            sections.pop(stage, None)
            continue
        duration = round((time.perf_counter() - started) * 1000)
        logger.info("etapa terminada", extra={"stage": stage, "duration_ms": duration})
        stages[stage] = StageResult(status="done", durationMs=duration)
        if value is not None:
            sections[stage] = value

    sections.update(context.extra)
    sections["schemaVersion"] = 1
    sections["stages"] = {
        name: result.model_dump(exclude_unset=True) for name, result in stages.items()
    }
    return Outcome(results=AnalysisResults.model_validate(sections), detail_count=len(data.details))
