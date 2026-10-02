"""El orquestador con las técnicas reales sobre el conjunto de validación (feature 007, US2)."""

import time
from typing import Any

import pytest

import analytics.mining.techniques  # noqa: F401 - registra las técnicas
from analytics.mining.run import TECHNIQUES, process
from analytics.mining.schemas import ProgressStage

from .helpers import context, detail

TEXT_STAGES = ["keywords", "cooccurrence", "topics", "clusters"]


async def run(details: list[dict[str, Any]] | None = None) -> Any:
    ctx = context(details)
    seen: list[ProgressStage] = []

    async def progress(stage: ProgressStage, pct: int) -> None:
        seen.append(stage)

    job = ctx.job.model_copy(update={"stages": TEXT_STAGES})
    return await process(job, ctx.data, None, progress), seen


@pytest.mark.asyncio
async def test_el_analisis_de_texto_completo_produce_resultados_validos() -> None:
    assert set(TEXT_STAGES) <= set(TECHNIQUES)
    started = time.perf_counter()
    outcome, seen = await run()
    seconds = time.perf_counter() - started
    assert seen == TEXT_STAGES
    assert outcome.partial is False
    results = outcome.results
    assert all(results.stages[stage].status == "done" for stage in TEXT_STAGES)
    assert results.keywords and results.cooccurrence and results.topics and results.clusters
    assert results.preprocess is not None and results.preprocess.unrecognizedRatio is not None
    # 300 detalles: muy por debajo de los 5 minutos de SC-002 para 2 000.
    assert seconds < 120


@pytest.mark.asyncio
async def test_con_menos_de_20_detalles_solo_hay_palabras_clave() -> None:
    outcome, _ = await run(
        [detail(index, given=f"el pedido {index} existe") for index in range(12)]
    )
    stages = outcome.results.stages
    assert stages["keywords"].status == "done"
    for stage in ("cooccurrence", "topics", "clusters"):
        assert stages[stage].status == "skipped"
        assert stages[stage].reason == "INSUFFICIENT_DATA"
    assert outcome.results.topics is None
