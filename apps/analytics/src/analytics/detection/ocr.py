"""Lectura del texto de cada zona con Tesseract (research R4)."""

import re
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
import pytesseract
from numpy.typing import NDArray

from analytics.detection.preprocess import Image8, grayscale
from analytics.detection.shapes import Box

# Por debajo de esta confianza media, el texto no es fiable (manuscritos, baja resolución).
MIN_CONFIDENCE = 0.40
_MARGIN = 3
_WORD = re.compile(r"\w", re.UNICODE)


@dataclass(frozen=True)
class Reading:
    text: str
    """Texto limpio; vacío si no se pudo leer con confianza suficiente."""
    confidence: float
    """Confianza media por palabra, 0–1."""


def clean(words: list[str]) -> str:
    """Une las líneas, quita restos sin letras ni números (bordes leídos como `|` o `—`) y
    normaliza los espacios. No traduce ni corrige: el texto se deja tal cual."""
    kept = [word.strip() for word in words if _WORD.search(word)]
    return " ".join(" ".join(kept).split())


def _u8(array: object) -> Image8:
    return np.asarray(array, dtype=np.uint8)


def _prepare(image: Image8, interior: Box, outline: NDArray[Any] | None) -> Image8 | None:
    x0, y0 = interior.x + _MARGIN, interior.y + _MARGIN
    x1, y1 = interior.x + interior.w - _MARGIN, interior.y + interior.h - _MARGIN
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    crop = grayscale(image[y0:y1, x0:x1])
    inside: Image8 | None = None
    if outline is not None:
        # Solo el hueco de la forma, sin el trazo: las esquinas redondeadas y el borde de color
        # se leerían como letras sueltas.
        inside = np.zeros(crop.shape, np.uint8)
        cv2.drawContours(inside, [outline - np.array([x0, y0])], -1, 255, thickness=-1)
        inside = _u8(cv2.erode(inside, np.ones((3, 3), np.uint8), iterations=2))
    crop = _u8(cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
    if inside is not None:
        inside = _u8(cv2.resize(inside, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
        # Fuera del hueco, el color del fondo de la forma: no altera el umbral de Otsu.
        crop[inside == 0] = int(np.median(crop[inside > 0])) if np.any(inside) else 255
    _, binary = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Texto oscuro sobre claro, con margen blanco: es lo que Tesseract lee mejor.
    if float(np.mean(binary)) < 127:
        binary = cv2.bitwise_not(binary)
    return np.asarray(
        cv2.copyMakeBorder(binary, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255), dtype=np.uint8
    )


def read_label(
    image: Image8,
    interior: Box,
    languages: tuple[str, ...] = ("spa", "eng"),
    outline: NDArray[Any] | None = None,
) -> Reading:
    prepared = _prepare(image, interior, outline)
    if prepared is None:
        return Reading("", 0.0)
    data = pytesseract.image_to_data(
        prepared,
        lang="+".join(languages),
        config="--oem 1 --psm 6",
        output_type=pytesseract.Output.DICT,
    )
    words, confidences = [], []
    for text, confidence in zip(data["text"], data["conf"], strict=True):
        if str(text).strip() and float(confidence) >= 0:
            words.append(str(text))
            confidences.append(float(confidence) / 100)
    text = clean(words)
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    if not text or confidence < MIN_CONFIDENCE:
        return Reading("", confidence)
    return Reading(text, confidence)
