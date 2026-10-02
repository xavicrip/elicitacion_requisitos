"""Preproceso de la detección (feature 006, T020)."""

import cv2
import numpy as np
import pytest

from analytics.detection.preprocess import (
    UnreadableImageError,
    binarize,
    decode,
    downscale,
    grayscale,
)


def test_decode_lee_png_y_webp_y_rechaza_lo_que_no_es_imagen() -> None:
    image = np.full((40, 60, 3), 255, np.uint8)
    for extension in (".png", ".webp"):
        ok, encoded = cv2.imencode(extension, image)
        assert ok
        assert decode(encoded.tobytes()).shape == (40, 60, 3)
    with pytest.raises(UnreadableImageError):
        decode(b"no es una imagen")


def test_downscale_limita_el_lado_mayor_a_3000_px() -> None:
    image = np.zeros((4000, 6000, 3), np.uint8)
    small, scale = downscale(image)
    assert small.shape[:2] == (2000, 3000)
    assert scale == pytest.approx(0.5)
    same, unchanged = downscale(np.zeros((100, 200, 3), np.uint8))
    assert same.shape[:2] == (100, 200) and unchanged == 1.0


def test_binarize_deja_los_trazos_en_blanco_aunque_haya_poco_contraste() -> None:
    image = np.full((200, 200), 180, np.uint8)
    cv2.rectangle(image, (50, 50), (150, 150), 120, 3)  # gris sobre gris
    mask = binarize(grayscale(cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)))
    assert mask[50, 100] == 255  # sobre el trazo
    assert mask[100, 100] == 0  # dentro
    assert mask[10, 10] == 0  # fondo
