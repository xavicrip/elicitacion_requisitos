"""Formas UML del diagrama (research R3).

Las flechas tocan el borde de las formas y deforman su contorno exterior, así que las acciones,
las decisiones y el anillo del fin se reconocen por su **contorno interior** (el hueco que deja
el trazo cerrado), al que no llegan las flechas. Los círculos rellenos (inicio y disco central del
fin) se buscan aparte, tras una apertura morfológica que borra las líneas finas.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Literal

import cv2
from numpy.typing import NDArray

from analytics.detection.preprocess import Image8, binarize, grayscale

ShapeType = Literal["action", "decision", "start", "end"]

# Grosor aproximado del trazo: la caja del hueco se amplía para cubrir la forma dibujada.
STROKE_PAD = 2


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    @property
    def area(self) -> int:
        return self.w * self.h

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.w / 2, self.y + self.h / 2

    def contains(self, point: tuple[float, float]) -> bool:
        px, py = point
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h

    def padded(self, pad: int, width: int, height: int) -> "Box":
        x0, y0 = max(0, self.x - pad), max(0, self.y - pad)
        x1, y1 = min(width, self.x + self.w + pad), min(height, self.y + self.h + pad)
        return Box(x0, y0, x1 - x0, y1 - y0)


@dataclass(frozen=True)
class Shape:
    type: ShapeType
    box: Box
    """Caja de la forma dibujada (px de la imagen analizada)."""
    interior: Box
    """Interior sin el trazo: la zona donde se lee el texto."""
    geometry: float
    """Calidad del ajuste geométrico, 0–1."""
    outline: "Contour | None" = field(default=None, compare=False, repr=False)
    """Contorno del hueco: el OCR ignora lo que queda fuera (las esquinas redondeadas)."""


# OpenCV tipa los contornos de forma imprecisa; son arrays de puntos (N, 1, 2).
Contour = NDArray[Any]


def _clip(value: float) -> float:
    return max(0.0, min(1.0, value))


def _measures(contour: Contour) -> tuple[float, Box, float, float, float]:
    area = float(cv2.contourArea(contour))
    x, y, w, h = cv2.boundingRect(contour)
    perimeter = float(cv2.arcLength(contour, closed=True)) or 1.0
    circularity = 4 * math.pi * area / perimeter**2
    extent = area / max(1, w * h)
    aspect = w / max(1, h)
    return area, Box(x, y, w, h), circularity, extent, aspect


@dataclass(frozen=True)
class _Disc:
    box: Box
    circularity: float


def _filled_discs(mask: Image8, min_area: float) -> list[_Disc]:
    """Manchas rellenas y redondas: la apertura borra trazos y flechas de 2–3 px."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    discs = []
    for contour in contours:
        area, box, circularity, _, aspect = _measures(contour)
        if area >= min_area and circularity > 0.75 and 0.75 < aspect < 1.33:
            discs.append(_Disc(box, circularity))
    return discs


def detect_shapes(image: Image8) -> list[Shape]:
    """Acciones, decisiones, inicio y fin, ordenadas de arriba abajo y de izquierda a derecha."""
    mask = binarize(grayscale(image))
    height, width = mask.shape[:2]
    image_area = height * width
    min_hole = max(400.0, 0.00012 * image_area)

    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    discs = _filled_discs(mask, min_area=150)
    used_discs: set[int] = set()
    shapes: list[Shape] = []

    for index, contour in enumerate(contours):
        # Con RETR_CCOMP, los huecos son los contornos con padre.
        if hierarchy is None or hierarchy[0][index][3] == -1:
            continue
        area, box, circularity, extent, aspect = _measures(contour)
        if area < min_hole or area > 0.5 * image_area:
            continue
        outer = box.padded(STROKE_PAD, width, height)

        if circularity > 0.8 and 0.8 < aspect < 1.25 and 0.7 <= extent < 0.85:
            # Anillo del fin: debe rodear un disco relleno centrado.
            for disc_index, disc in enumerate(discs):
                if disc_index in used_discs or not box.contains(disc.box.center):
                    continue
                ratio = disc.box.w / max(1, box.w)
                if 0.3 <= ratio <= 0.85:
                    used_discs.add(disc_index)
                    geometry = 0.6 + 0.4 * _clip((circularity - 0.8) / 0.15)
                    shapes.append(Shape("end", outer, box, geometry, contour))
                    break
        elif 0.4 <= extent <= 0.62 and 0.75 < aspect < 1.33:
            fit = _clip(1 - abs(extent - 0.5) / 0.12) * _clip(1 - abs(math.log(aspect)) / 0.3)
            shapes.append(Shape("decision", outer, box, 0.5 + 0.5 * fit, contour))
        elif extent >= 0.85 and aspect >= 0.5:
            fit = _clip(1 - abs(extent - 0.95) / 0.12)
            shapes.append(Shape("action", outer, box, 0.5 + 0.5 * fit, contour))

    for disc_index, disc in enumerate(discs):
        if disc_index in used_discs or disc.box.w < 14:
            continue
        # Un disco dentro de otra forma no es un inicio (p. ej., un punto en un texto grande).
        if any(shape.interior.contains(disc.box.center) for shape in shapes):
            continue
        geometry = 0.5 + 0.5 * _clip((disc.circularity - 0.75) / 0.2)
        shapes.append(Shape("start", disc.box.padded(1, width, height), disc.box, geometry))

    return sorted(shapes, key=lambda shape: (shape.box.y, shape.box.x))
