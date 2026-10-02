"""Datos de prueba de la minería: el conjunto de validación y contextos del orquestador."""

import json
from pathlib import Path
from typing import Any

from analytics.mining.run import Context
from analytics.mining.schemas import AnalysisInputFile, AnalysisJobInput

TESTS = Path(__file__).parents[1]
VALIDATION: dict[str, Any] = json.loads(
    (TESTS / "fixtures/details/validation.json").read_text(encoding="utf-8")
)
TRUTH: dict[str, Any] = VALIDATION["truth"]
JOB: dict[str, Any] = json.loads(
    (TESTS / "contract/examples/analysis/job-input.json").read_text(encoding="utf-8")
)


def detail(index: int, **fields: Any) -> dict[str, Any]:
    base = {
        "id": f"d{index}",
        "diagramId": "66f100000000000000000001",
        "activityKey": "act-01",
        "given": "el cliente tiene productos en el carrito",
        "when": "confirma el pago del pedido",
        "then": "la pasarela autoriza la transacción",
        "type": "functional",
        "priority": None,
        "authorRole": None,
        "tags": [],
        "status": "pending",
        "voteCount": 0,
        "commentCount": 0,
        "createdAt": "2026-10-01T15:00:00.000Z",
    }
    return {**base, **fields}


def context(details: list[dict[str, Any]] | None = None, **settings: Any) -> Context:
    """Contexto con el conjunto de validación completo o con los detalles indicados."""
    payload = dict(VALIDATION["input"])
    if details is not None:
        payload["details"] = details
    job = {**JOB, "settings": {**JOB["settings"], "extraStopwords": [], **settings}}
    return Context(
        job=AnalysisJobInput.model_validate(job),
        data=AnalysisInputFile.model_validate(payload),
        previous=None,
    )
