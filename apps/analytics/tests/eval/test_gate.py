"""Gate de precisión de la detección (feature 006, T022; SC-001 y SC-002).

En cada `pytest` se evalúa una muestra del subconjunto digital (un diagrama por estilo y el de
50 actividades); el job `detection-eval` del CI ejecuta `evaluate_detection.py` sobre los 20.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from evaluate_detection import LABEL_GATE, ZONE_GATE, evaluate, iou, similar  # noqa: E402

SAMPLE = ["001", "002", "003", "020"]


def test_la_muestra_digital_supera_el_gate() -> None:
    totals = evaluate("digital", ids=SAMPLE)
    digital = totals["digital"]
    assert digital.zone_recall >= ZONE_GATE, digital.misses
    assert digital.label_accuracy >= LABEL_GATE, digital.misses
    assert digital.proposals <= digital.zones * 1.1  # pocos falsos positivos


def test_iou_y_similitud() -> None:
    box = {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}
    assert iou(box, box) == pytest.approx(1.0)
    assert iou(box, {"x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}) == 0.0
    assert similar("Validar pago", "validar  pago")
    assert not similar("Validar pago", "Validar")
