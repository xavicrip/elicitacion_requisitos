"""Formas UML (feature 006, T020): dibujadas con OpenCV, con flechas que tocan los bordes."""

import cv2
import numpy as np
import pytest

from analytics.detection.shapes import Shape, detect_shapes

BLACK = (0, 0, 0)


def canvas(width: int = 900, height: int = 700) -> np.ndarray:
    return np.full((height, width, 3), 255, np.uint8)


def rounded_rect(image: np.ndarray, x: int, y: int, w: int, h: int, r: int = 16) -> None:
    cv2.rectangle(image, (x + r, y), (x + w - r, y + h), (230, 240, 255), -1)
    cv2.rectangle(image, (x, y + r), (x + w, y + h - r), (230, 240, 255), -1)
    for cx, cy in ((x + r, y + r), (x + w - r, y + r), (x + r, y + h - r), (x + w - r, y + h - r)):
        cv2.circle(image, (cx, cy), r, (230, 240, 255), -1)
    cv2.line(image, (x + r, y), (x + w - r, y), BLACK, 2)
    cv2.line(image, (x + r, y + h), (x + w - r, y + h), BLACK, 2)
    cv2.line(image, (x, y + r), (x, y + h - r), BLACK, 2)
    cv2.line(image, (x + w, y + r), (x + w, y + h - r), BLACK, 2)
    for (cx, cy), start in (
        ((x + r, y + r), 180),
        ((x + w - r, y + r), 270),
        ((x + w - r, y + h - r), 0),
        ((x + r, y + h - r), 90),
    ):
        cv2.ellipse(image, (cx, cy), (r, r), 0, start, start + 90, BLACK, 2)


def diamond(image: np.ndarray, cx: int, cy: int, half: int = 40) -> None:
    points = np.array([[cx, cy - half], [cx + half, cy], [cx, cy + half], [cx - half, cy]])
    cv2.polylines(image, [points], True, BLACK, 2)


def by_type(shapes: list[Shape], type_: str) -> list[Shape]:
    return [shape for shape in shapes if shape.type == type_]


def test_reconoce_los_cuatro_tipos_aunque_las_flechas_toquen_los_bordes() -> None:
    image = canvas()
    cv2.circle(image, (450, 60), 18, BLACK, -1)  # inicio
    rounded_rect(image, 320, 130, 260, 72)  # acción
    diamond(image, 450, 320)  # decisión
    cv2.circle(image, (450, 500), 22, BLACK, 3)  # fin: anillo…
    cv2.circle(image, (450, 500), 12, BLACK, -1)  # …con disco central
    for y0, y1 in ((78, 130), (202, 280), (360, 478)):
        cv2.arrowedLine(image, (450, y0), (450, y1), BLACK, 2, tipLength=0.15)
    shapes = detect_shapes(image)
    assert [shape.type for shape in shapes] == ["start", "action", "decision", "end"]
    action = by_type(shapes, "action")[0]
    assert abs(action.box.x - 320) <= 4 and abs(action.box.w - 260) <= 6
    assert all(0 <= shape.geometry <= 1 for shape in shapes)
    assert action.geometry >= 0.8


def test_el_texto_dentro_de_una_accion_no_se_propone_como_forma() -> None:
    image = canvas()
    rounded_rect(image, 100, 100, 300, 80)
    cv2.putText(image, "Validar pago o no", (120, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.9, BLACK, 2)
    shapes = detect_shapes(image)
    assert [shape.type for shape in shapes] == ["action"]


def test_descarta_contornos_diminutos_y_lineas_sueltas() -> None:
    image = canvas()
    cv2.rectangle(image, (50, 50), (58, 58), BLACK, 1)  # cuadradito
    cv2.line(image, (100, 300), (800, 300), BLACK, 2)
    cv2.arrowedLine(image, (100, 400), (800, 420), BLACK, 2)
    assert detect_shapes(image) == []


def test_un_circulo_relleno_sin_anillo_es_inicio_y_un_anillo_vacio_no_es_nada() -> None:
    image = canvas()
    cv2.circle(image, (200, 200), 20, BLACK, -1)
    cv2.circle(image, (600, 200), 30, BLACK, 3)
    shapes = detect_shapes(image)
    assert [shape.type for shape in shapes] == ["start"]


@pytest.mark.parametrize("angle", [-2.0, 2.0])
def test_tolera_una_leve_rotacion(angle: float) -> None:
    image = canvas()
    rounded_rect(image, 320, 130, 260, 72)
    diamond(image, 450, 320)
    matrix = cv2.getRotationMatrix2D((450, 350), angle, 1.0)
    rotated = cv2.warpAffine(image, matrix, (900, 700), borderValue=(255, 255, 255))
    assert sorted(shape.type for shape in detect_shapes(rotated)) == ["action", "decision"]
