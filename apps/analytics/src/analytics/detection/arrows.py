"""Flechas entre las formas detectadas (research R6, US3).

Sobre la máscara binaria se borran las formas ya reconocidas: cada flecha (su polilínea y su
punta) queda como un componente conexo cortado en los bordes de las cajas. Un componente que
toca dos formas es una transición; la punta, un triángulo relleno que sobrevive a una apertura
morfológica que borra las líneas finas, indica el destino. Una línea sin punta no se propone.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from analytics.detection.preprocess import Image8, binarize, grayscale
from analytics.detection.shapes import Box, Shape

# Margen con que se borran las formas (las líneas quedan cortadas justo fuera del trazo).
_CUT = 3
# Anillo alrededor de cada forma donde se busca el extremo de una línea.
_REACH = 10
_MIN_LINE_PIXELS = 25


@dataclass(frozen=True)
class Arrow:
    source: int
    """Índice de la forma de origen en la lista recibida."""
    target: int
    confidence: float


def _ring_touches(labels: np.ndarray, component: int, box: Box, width: int, height: int) -> bool:
    outer = box.padded(_CUT + _REACH, width, height)
    window = labels[outer.y : outer.y + outer.h, outer.x : outer.x + outer.w] == component
    return bool(window.any())


def _heads(component_mask: Image8) -> list[tuple[float, float, float, float]]:
    """Puntas del componente: (x, y, calidad 0–1, área). La calidad mide cuánto se parece la mancha
    a un triángulo (área frente al triángulo mínimo que la envuelve): baja con puntas borrosas."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(component_mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    heads = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < 12:
            continue
        triangle_area, _ = cv2.minEnclosingTriangle(contour.astype(np.float32))
        quality = area / triangle_area if triangle_area > 0 else 0.0
        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue
        heads.append(
            (moments["m10"] / moments["m00"], moments["m01"] / moments["m00"], quality, area)
        )
    return heads


def _distance(point: tuple[float, float], box: Box) -> float:
    px, py = point
    dx = max(box.x - px, 0.0, px - (box.x + box.w))
    dy = max(box.y - py, 0.0, py - (box.y + box.h))
    return float(np.hypot(dx, dy))


def detect_arrows(image: Image8, shapes: list[Shape]) -> list[Arrow]:
    """Transiciones dirigidas entre `shapes`, sin repetir pares, en el orden de las formas."""
    mask = binarize(grayscale(image)).copy()
    height, width = mask.shape[:2]
    for shape in shapes:
        cut = shape.box.padded(_CUT, width, height)
        mask[cut.y : cut.y + cut.h, cut.x : cut.x + cut.w] = 0

    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    found: dict[tuple[int, int], float] = {}
    for component in range(1, count):
        x, y, w, h, pixels = (int(value) for value in stats[component])
        if pixels < _MIN_LINE_PIXELS:
            continue
        reach = Box(x, y, w, h).padded(_CUT + _REACH, width, height)
        touched = [
            index
            for index, shape in enumerate(shapes)
            if _overlaps(reach, shape.box)
            and _ring_touches(labels, component, shape.box, width, height)
        ]
        if len(touched) < 2:
            continue
        component_mask = np.where(labels[y : y + h, x : x + w] == component, 255, 0).astype(
            np.uint8
        )
        heads = [
            (hx + x, hy + y, quality, area) for hx, hy, quality, area in _heads(component_mask)
        ]
        if len(touched) == 2 and heads:
            # Una línea entre dos formas es una sola flecha. La punta real toca su forma; el
            # ruido de un escaneo puede dejar otra mancha algo más lejos, junto al origen. La
            # calidad (forma de triángulo) solo desempata.
            heads = [max(heads, key=lambda head: _head_score(head, touched, shapes))]
        for hx, hy, quality, _area in heads:
            target = min(touched, key=lambda index: _distance((hx, hy), shapes[index].box))
            if _distance((hx, hy), shapes[target].box) > _CUT + _REACH + 12:
                continue  # una mancha a mitad de línea, no una punta junto a una forma
            others = [index for index in touched if index != target]
            # Origen: la otra forma tocada más lejana de la punta (la línea sale de ella).
            source = max(others, key=lambda index: _distance((hx, hy), shapes[index].box))
            confidence = round(0.55 + 0.45 * max(0.0, min(1.0, (quality - 0.5) / 0.4)), 3)
            key = (source, target)
            found[key] = max(found.get(key, 0.0), confidence)
    return [
        Arrow(source, target, confidence) for (source, target), confidence in sorted(found.items())
    ]


def _head_score(
    head: tuple[float, float, float, float], touched: list[int], shapes: list[Shape]
) -> float:
    gap = min(_distance((head[0], head[1]), shapes[index].box) for index in touched)
    return 10 * head[2] - gap


def _overlaps(a: Box, b: Box) -> bool:
    return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h
