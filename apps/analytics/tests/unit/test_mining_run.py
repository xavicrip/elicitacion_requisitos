"""Orquestador del análisis (feature 007, T016): etapas, umbral de 20 detalles y fallos."""

import json
from pathlib import Path
from typing import Any

import pytest

from analytics.mining.run import Context, process
from analytics.mining.schemas import (
    AnalysisInputFile,
    AnalysisJobInput,
    AnalysisResults,
    ProgressStage,
)

EXAMPLES = Path(__file__).parents[1] / "contract" / "examples" / "analysis"
VALIDATION = json.loads(
    (Path(__file__).parents[1] / "fixtures/details/validation.json").read_text("utf-8")
)

pytestmark = pytest.mark.asyncio


def example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text("utf-8"))
    return data


def job(**changes: Any) -> AnalysisJobInput:
    return AnalysisJobInput.model_validate({**example("job-input"), **changes})


def data(count: int = 300) -> AnalysisInputFile:
    payload = dict(VALIDATION["input"])
    payload["details"] = payload["details"][:count]
    return AnalysisInputFile.model_validate(payload)


async def collect(stages: list[tuple[ProgressStage, int]]) -> Any:
    async def progress(stage: ProgressStage, pct: int) -> None:
        stages.append((stage, pct))

    return progress


async def test_ejecuta_las_etapas_en_orden_con_progreso_y_guarda_cada_seccion() -> None:
    seen: list[tuple[ProgressStage, int]] = []
    calls: list[str] = []

    def keywords(context: Context) -> dict[str, Any]:
        calls.append("keywords")
        context.shared["docs"] = len(context.data.details)
        return {"wordCloud": [{"term": "pago", "weight": 3}]}

    def quality(context: Context) -> list[Any]:
        calls.append("quality")
        assert context.shared["docs"] == 300
        return []

    outcome = await process(
        job(stages=["keywords", "quality"]),
        data(),
        None,
        await collect(seen),
        {"keywords": keywords, "quality": quality},
    )
    assert calls == ["keywords", "quality"]
    assert [stage for stage, _ in seen] == ["keywords", "quality"]
    assert outcome.detail_count == 300
    assert outcome.partial is False
    assert outcome.results.keywords is not None
    assert outcome.results.stages["keywords"].status == "done"
    assert outcome.results.stages["keywords"].durationMs is not None


async def test_una_etapa_que_falla_no_detiene_las_demas() -> None:
    def broken(context: Context) -> Any:
        raise ValueError("detalle interno")

    outcome = await process(
        job(stages=["sentiment", "quality"]),
        data(),
        None,
        await collect([]),
        {"sentiment": broken, "quality": lambda context: []},
    )
    assert outcome.partial is True
    assert outcome.results.stages["sentiment"].status == "failed"
    assert outcome.results.stages["sentiment"].error == "ValueError"
    assert outcome.results.sentiment is None
    assert outcome.results.stages["quality"].status == "done"


async def test_con_menos_de_20_detalles_solo_corren_las_tecnicas_sin_minimo() -> None:
    ran: list[str] = []

    def recorder(name: str) -> Any:
        return lambda context: ran.append(name)

    techniques = {
        name: recorder(name) for name in ("keywords", "topics", "quality", "hotcold", "duplicates")
    }
    outcome = await process(
        job(stages=["keywords", "topics", "duplicates", "quality", "hotcold"]),
        data(12),
        None,
        await collect([]),
        techniques,
    )
    assert ran == ["keywords", "quality", "hotcold"]
    for stage in ("topics", "duplicates"):
        assert outcome.results.stages[stage].status == "skipped"
        assert outcome.results.stages[stage].reason == "INSUFFICIENT_DATA"
    assert outcome.partial is False


async def test_sin_tecnica_o_con_insights_desactivados_la_etapa_se_omite() -> None:
    settings = {**example("job-input")["settings"], "insightsEnabled": False}
    outcome = await process(
        job(stages=["association", "insights"], settings=settings),
        data(),
        None,
        await collect([]),
        {"insights": lambda context: []},
    )
    assert outcome.results.stages["association"].reason == "UNAVAILABLE"
    assert outcome.results.stages["insights"].reason == "DISABLED"


async def test_regenerar_insights_conserva_las_demas_secciones_del_run_original() -> None:
    previous = AnalysisResults.model_validate(example("results"))
    regenerate = AnalysisJobInput.model_validate(example("job-input-insights"))
    new_insight = {
        "id": "n1",
        "title": "Nuevo",
        "statement": "Un hallazgo nuevo.",
        "evidence": [{"kind": "activity", "id": "act-04"}],
    }
    outcome = await process(
        regenerate,
        data(),
        previous,
        await collect([]),
        {"insights": lambda context: [new_insight]},
    )
    assert outcome.results.topics == previous.topics
    assert outcome.results.quality == previous.quality
    assert [insight.id for insight in outcome.results.insights or []] == ["n1"]
    assert outcome.results.stages["keywords"] == previous.stages["keywords"]
    assert outcome.results.stages["insights"].status == "done"


async def test_las_secciones_extra_del_contexto_se_incluyen() -> None:
    def keywords(context: Context) -> None:
        context.extra["preprocess"] = {"unrecognizedRatio": 0.1}

    outcome = await process(
        job(stages=["keywords"]), data(), None, await collect([]), {"keywords": keywords}
    )
    assert outcome.results.preprocess is not None
    assert outcome.results.preprocess.unrecognizedRatio == 0.1
