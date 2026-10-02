"""Contrato de la cola `analysis` del lado Python (feature 007, T008).

Los mismos ejemplos los valida `packages/shared/tests/analytics.test.ts` (zod); los resultados
validan además contra `analysis-results.schema.json`.
"""

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from pydantic import BaseModel, ValidationError

from analytics.mining.schemas import (
    AnalysisInputFile,
    AnalysisJobInput,
    AnalysisJobReturn,
    AnalysisProgress,
    AnalysisResults,
)

EXAMPLES = Path(__file__).parent / "examples" / "analysis"
RESULTS_SCHEMA = (
    Path(__file__).parents[4]
    / "specs/007-dashboard-analitico/contracts/analysis-results.schema.json"
)


def example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))
    return data


CASES: list[tuple[str, type[BaseModel]]] = [
    ("job-input", AnalysisJobInput),
    ("job-input-insights", AnalysisJobInput),
    ("input-file", AnalysisInputFile),
    ("return-done", AnalysisJobReturn),
    ("return-partial", AnalysisJobReturn),
    ("return-insufficient", AnalysisJobReturn),
    ("return-failed", AnalysisJobReturn),
    ("progress", AnalysisProgress),
    ("results", AnalysisResults),
]


@pytest.mark.parametrize(("name", "model"), CASES)
def test_los_ejemplos_validan_y_la_ida_y_vuelta_conserva_el_json(
    name: str, model: type[BaseModel]
) -> None:
    original = example(name)
    dumped = model.model_validate(original).model_dump(
        mode="json", by_alias=True, exclude_unset=True
    )
    assert dumped == original


def test_los_resultados_cumplen_el_esquema_json() -> None:
    schema = json.loads(RESULTS_SCHEMA.read_text(encoding="utf-8"))
    jsonschema.validate(example("results"), schema)
    # Lo que produce el worker (sin secciones vacías) también.
    results = AnalysisResults.model_validate(example("results"))
    jsonschema.validate(results.model_dump(mode="json", by_alias=True, exclude_unset=True), schema)


@pytest.mark.parametrize(
    ("name", "model", "change"),
    [
        ("job-input", AnalysisJobInput, {"v": 2}),
        ("job-input", AnalysisJobInput, {"stages": ["magia"]}),
        ("job-input", AnalysisJobInput, {"stages": ["keywords", "keywords"]}),
        ("job-input-insights", AnalysisJobInput, {"previousResultsUrl": None}),
        ("job-input-insights", AnalysisJobInput, {"stages": ["insights", "quality"]}),
        ("results", AnalysisResults, {"schemaVersion": 2}),
        ("return-failed", AnalysisJobReturn, {"error": None}),
        ("return-done", AnalysisJobReturn, {"stages": {"keywords": {"status": "completed"}}}),
    ],
)
def test_rechaza_lo_que_no_cumple_el_contrato(
    name: str, model: type[BaseModel], change: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate({**example(name), **change})


def test_el_archivo_de_entrada_no_admite_datos_del_autor() -> None:
    data = example("input-file")
    data["details"][0]["authorId"] = "66f0"
    with pytest.raises(ValidationError):
        AnalysisInputFile.model_validate(data)


def test_un_insight_necesita_evidencia_y_hay_como_maximo_10() -> None:
    data = example("results")
    insight = data["insights"][0]
    with pytest.raises(ValidationError):
        AnalysisResults.model_validate({**data, "insights": [{**insight, "evidence": []}]})
    with pytest.raises(ValidationError):
        AnalysisResults.model_validate(
            {**data, "insights": [{**insight, "id": f"i{i}"} for i in range(11)]}
        )


def test_el_conjunto_de_validacion_tiene_el_formato_del_archivo_de_entrada() -> None:
    validation = json.loads(
        (Path(__file__).parents[1] / "fixtures/details/validation.json").read_text("utf-8")
    )
    parsed = AnalysisInputFile.model_validate(validation["input"])
    assert len(parsed.details) == 300
