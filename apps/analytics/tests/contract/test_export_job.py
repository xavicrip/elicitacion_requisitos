"""Contrato de la cola `export` del lado Python (feature 008, T033).

Los mismos ejemplos los valida `packages/shared/tests/exports.test.ts` (zod).
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from analytics.reports.schemas import ExportInputFile, ExportJobInput, ExportJobReturn

EXAMPLES = Path(__file__).parent / "examples" / "export"


def example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))
    return data


CASES: list[tuple[str, type[BaseModel]]] = [
    ("job-input", ExportJobInput),
    ("input-file", ExportInputFile),
    ("input-file-no-analysis", ExportInputFile),
    ("return-done", ExportJobReturn),
    ("return-failed", ExportJobReturn),
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


@pytest.mark.parametrize(
    ("name", "model", "change"),
    [
        ("job-input", ExportJobInput, {"v": 2}),
        ("job-input", ExportJobInput, {"outputUrl": "no es una URL"}),
        ("input-file", ExportInputFile, {"schemaVersion": 2}),
        ("input-file", ExportInputFile, {"analysis": {"finishedAt": "2026-10-03T14:00:00Z"}}),
        ("return-failed", ExportJobReturn, {"error": None}),
        ("return-failed", ExportJobReturn, {"error": {"code": "", "message": "x"}}),
        ("return-done", ExportJobReturn, {"pages": 0}),
        ("return-done", ExportJobReturn, {"bytes": None}),
    ],
)
def test_rechaza_lo_que_no_cumple_el_contrato(
    name: str, model: type[BaseModel], change: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate({**example(name), **change})


def test_el_archivo_de_entrada_no_admite_datos_del_autor() -> None:
    data = example("input-file")
    for field in ("authorId", "authorName"):
        details = [{**data["details"][0], field: "Ana"}, *data["details"][1:]]
        with pytest.raises(ValidationError):
            ExportInputFile.model_validate({**data, "details": details})
