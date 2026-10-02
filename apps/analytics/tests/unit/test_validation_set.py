"""Conjunto de validación de la detección (feature 006, T004): reproducible y coherente."""

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from types import ModuleType

import cv2
import numpy as np
import pytest

FIXTURES = Path(__file__).parents[1] / "fixtures"


def _load_generator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("generate", FIXTURES / "generate.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate"] = module  # lo necesitan las dataclasses
    spec.loader.exec_module(module)
    return module


generate = _load_generator()
TRUTHS = {
    path.stem: json.loads(path.read_text())
    for path in sorted((FIXTURES / "diagrams").glob("*.json"))
}


def test_treinta_diagramas_por_subconjunto() -> None:
    assert len(TRUTHS) == 30
    assert Counter(truth["subset"] for truth in TRUTHS.values()) == {
        "digital": 20,
        "scanned": 5,
        "photo": 5,
    }
    assert {truth["style"] for truth in TRUTHS.values()} == {"plantuml", "drawio", "staruml"}


@pytest.mark.parametrize("diagram_id", ["001", "004", "020", "022", "028"])
def test_reproducible_y_coincide_con_el_ground_truth_versionado(diagram_id: str) -> None:
    spec = next(spec for spec in generate.SPECS if spec.id == diagram_id)
    image, truth = generate.generate(spec)
    again, _ = generate.generate(spec)
    assert np.array_equal(image, again)
    assert truth == TRUTHS[diagram_id]
    assert image.shape[:2] == (truth["height"], truth["width"])


def test_ensure_genera_los_png_que_faltan() -> None:
    folder = generate.ensure()
    assert all((folder / f"{diagram_id}.png").exists() for diagram_id in TRUTHS)
    assert cv2.imread(str(folder / "004.png")) is not None


def test_casos_del_quickstart() -> None:
    assert len(TRUTHS["001"]["activities"]) == 15
    linear = TRUTHS["004"]
    assert [activity["type"] for activity in linear["activities"]] == ["action"] * 5
    assert len(linear["transitions"]) == 4
    assert max(len(truth["activities"]) for truth in TRUTHS.values()) == 50


@pytest.mark.parametrize("diagram_id", sorted(TRUTHS))
def test_ground_truth_coherente(diagram_id: str) -> None:
    truth = TRUTHS[diagram_id]
    ids = {activity["id"] for activity in truth["activities"]}
    for activity in truth["activities"]:
        box = activity["bbox"]
        assert 0 <= box["x"] and 0 <= box["y"] and box["w"] > 0 and box["h"] > 0
        assert box["x"] + box["w"] <= 1.0001 and box["y"] + box["h"] <= 1.0001
        assert activity["type"] in {"action", "decision", "start", "end"}
        assert bool(activity["label"]) == (activity["type"] == "action")
    for transition in truth["transitions"]:
        assert transition["from"] in ids and transition["to"] in ids
