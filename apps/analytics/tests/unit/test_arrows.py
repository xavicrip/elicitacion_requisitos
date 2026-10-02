"""Flechas entre formas (feature 006, US3, T038)."""

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np

from analytics.detection.arrows import detect_arrows
from analytics.detection.shapes import detect_shapes

FIXTURES = Path(__file__).parents[1] / "fixtures"
BLACK = (0, 0, 0)


def _diagrams() -> Path:
    spec = importlib.util.spec_from_file_location("generate", FIXTURES / "generate.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate"] = module
    spec.loader.exec_module(module)
    folder: Path = module.ensure()
    return folder


def boxes(image: np.ndarray, rows: int = 2) -> np.ndarray:
    """Dos acciones, una encima de otra, sin flecha."""
    for index in range(rows):
        y = 100 + index * 200
        cv2.rectangle(image, (300, y), (560, y + 70), BLACK, 2)
    return image


def canvas() -> np.ndarray:
    return np.full((600, 900, 3), 255, np.uint8)


def test_en_un_flujo_lineal_propone_las_cuatro_transiciones_en_orden() -> None:
    image = cv2.imread(str(_diagrams() / "004.png"))
    shapes = detect_shapes(image)
    order = sorted(range(len(shapes)), key=lambda index: shapes[index].box.y)
    arrows = detect_arrows(image, shapes)
    pairs = sorted((order.index(arrow.source), order.index(arrow.target)) for arrow in arrows)
    assert pairs == [(0, 1), (1, 2), (2, 3), (3, 4)]
    assert all(0.55 <= arrow.confidence <= 1 for arrow in arrows)


def test_la_direccion_la_da_la_punta() -> None:
    image = boxes(canvas())
    cv2.arrowedLine(image, (430, 370), (430, 172), BLACK, 2, tipLength=0.08)  # de abajo arriba
    shapes = detect_shapes(image)
    [arrow] = detect_arrows(image, shapes)
    assert shapes[arrow.source].box.y > shapes[arrow.target].box.y


def test_una_polilinea_ortogonal_es_una_sola_transicion() -> None:
    image = boxes(canvas())
    points = np.array([[560, 135], [700, 135], [700, 335], [575, 335]])
    cv2.polylines(image, [points], False, BLACK, 2)
    cv2.fillPoly(image, [np.array([[562, 335], [576, 328], [576, 342]])], BLACK)
    shapes = detect_shapes(image)
    arrows = detect_arrows(image, shapes)
    assert len(arrows) == 1
    assert shapes[arrows[0].source].box.y < shapes[arrows[0].target].box.y


def test_una_linea_sin_punta_no_se_propone() -> None:
    image = boxes(canvas())
    cv2.line(image, (430, 172), (430, 298), BLACK, 2)
    assert detect_arrows(image, detect_shapes(image)) == []


def test_una_flecha_suelta_que_no_une_dos_formas_no_se_propone() -> None:
    image = boxes(canvas())
    cv2.arrowedLine(image, (650, 500), (850, 500), BLACK, 2, tipLength=0.1)
    assert detect_arrows(image, detect_shapes(image)) == []


def test_una_punta_borrosa_baja_la_confianza() -> None:
    sharp = boxes(canvas())
    cv2.arrowedLine(sharp, (430, 172), (430, 298), BLACK, 2, tipLength=0.12)
    blurred = cv2.GaussianBlur(sharp, (9, 9), 3)
    [clear] = detect_arrows(sharp, detect_shapes(sharp))
    fuzzy = detect_arrows(blurred, detect_shapes(blurred))
    assert len(fuzzy) <= 1
    if fuzzy:
        assert fuzzy[0].confidence <= clear.confidence
