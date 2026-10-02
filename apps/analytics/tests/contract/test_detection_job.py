"""Contrato de la cola `detection` del lado Python (feature 006, T008).

Los mismos ejemplos los valida `packages/shared/tests/detection.test.ts` (zod).
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from analytics.detection.schemas import DetectionJobInput, DetectionProgress, DetectionResult

EXAMPLES = Path(__file__).parent / "examples"


def example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))
    return data


@pytest.mark.parametrize("name", ["result", "result-no-transitions", "result-empty"])
def test_los_resultados_de_ejemplo_validan(name: str) -> None:
    DetectionResult.model_validate(example(name))


def test_entrada_y_progreso_validan() -> None:
    job = DetectionJobInput.model_validate(example("input"))
    assert job.options.languages == ["spa", "eng"]
    assert job.image.width == 3200
    DetectionProgress.model_validate(example("progress"))


@pytest.mark.parametrize("name", ["result", "result-no-transitions", "result-empty"])
def test_ida_y_vuelta_conserva_el_json(name: str) -> None:
    original = example(name)
    dumped = DetectionResult.model_validate(original).model_dump(mode="json", by_alias=True)
    assert dumped == original


def _mutated(**changes: Any) -> dict[str, Any]:
    data = example("result")
    data.update(changes)
    return data


def test_rechaza_una_zona_fuera_de_la_imagen() -> None:
    data = example("result")
    data["activities"][0]["bbox"] = {"x": 0.9, "y": 0.1, "w": 0.2, "h": 0.1}
    with pytest.raises(ValidationError):
        DetectionResult.model_validate(data)


def test_rechaza_una_transicion_a_un_tempid_inexistente_o_a_si_misma() -> None:
    with pytest.raises(ValidationError):
        DetectionResult.model_validate(
            _mutated(transitions=[{"from": "a1", "to": "a9", "confidence": 0.5}])
        )
    with pytest.raises(ValidationError):
        DetectionResult.model_validate(
            _mutated(transitions=[{"from": "a1", "to": "a1", "confidence": 0.5}])
        )


def test_rechaza_tempid_repetidos_y_otra_version() -> None:
    data = example("result")
    data["activities"][1]["tempId"] = "a1"
    with pytest.raises(ValidationError):
        DetectionResult.model_validate(data)
    with pytest.raises(ValidationError):
        DetectionResult.model_validate(_mutated(v=2))


def test_progreso_fuera_de_rango_o_etapa_desconocida() -> None:
    with pytest.raises(ValidationError):
        DetectionProgress.model_validate({"stage": "ocr", "pct": 101})
    with pytest.raises(ValidationError):
        DetectionProgress.model_validate({"stage": "otra", "pct": 5})
