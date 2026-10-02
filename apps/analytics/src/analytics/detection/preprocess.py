"""Preproceso de la imagen del diagrama (research R3, paso 1)."""

import cv2
import numpy as np
from numpy.typing import NDArray

Image8 = NDArray[np.uint8]

MAX_SIDE = 3000


class UnreadableImageError(ValueError):
    """Los bytes descargados no son una imagen que OpenCV sepa leer."""


def decode(data: bytes) -> Image8:
    """PNG, JPEG o WebP → BGR."""
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise UnreadableImageError("Imagen ilegible")
    return np.asarray(image, dtype=np.uint8)


def downscale(image: Image8, max_side: int = MAX_SIDE) -> tuple[Image8, float]:
    """Reduce la imagen a ≤ `max_side` px por lado; devuelve la escala aplicada (≤ 1)."""
    h, w = image.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale == 1.0:
        return image, 1.0
    size = (round(w * scale), round(h * scale))
    return np.asarray(cv2.resize(image, size, interpolation=cv2.INTER_AREA), dtype=np.uint8), scale


def grayscale(image: Image8) -> Image8:
    if image.ndim == 2:
        return image
    return np.asarray(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), dtype=np.uint8)


def binarize(gray: Image8) -> Image8:
    """Trazos en blanco sobre negro: umbral adaptativo gaussiano (bloque 31), que tolera el bajo
    contraste y las sombras de las fotos, y un cierre de 3×3 que sella cortes de un píxel en los
    bordes de las formas (escaneos con ruido)."""
    mask = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 10
    )
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return np.asarray(closed, dtype=np.uint8)
