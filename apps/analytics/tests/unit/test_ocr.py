"""OCR por zona (feature 006, T021): texto renderizado con DejaVu, con tildes."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from analytics.detection.ocr import clean, read_label
from analytics.detection.shapes import Box

FONT = Path(__file__).parents[1] / "fixtures" / "fonts" / "DejaVuSans.ttf"


def zone(text: str, size: int = 22, width: int = 300, height: int = 80) -> np.ndarray:
    image = Image.new("RGB", (width, height), (254, 254, 206))
    draw = ImageDraw.Draw(image)
    draw.text(
        (width / 2, height / 2),
        text,
        font=ImageFont.truetype(str(FONT), size),
        fill=(0, 0, 0),
        anchor="mm",
    )
    return np.asarray(image)[:, :, ::-1].copy()


def read(image: np.ndarray) -> str:
    h, w = image.shape[:2]
    return read_label(image, Box(0, 0, w, h)).text


def test_lee_nombres_con_tildes() -> None:
    assert read(zone("Validar pago")) == "Validar pago"
    assert read(zone("Emitir factura")) == "Emitir factura"
    assert read(zone("Aprobación del crédito")) == "Aprobación del crédito"


def test_no_traduce_el_ingles() -> None:
    assert read(zone("Send invoice")) == "Send invoice"


def test_un_nombre_en_dos_lineas_queda_en_una() -> None:
    image = Image.new("RGB", (300, 90), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), 20)
    draw.text((150, 30), "Generar orden", font=font, fill=(0, 0, 0), anchor="mm")
    draw.text((150, 60), "de compra", font=font, fill=(0, 0, 0), anchor="mm")
    assert read(np.asarray(image)[:, :, ::-1].copy()) == "Generar orden de compra"


def test_sin_texto_o_ilegible_devuelve_vacio_con_confianza_baja() -> None:
    blank = np.full((80, 300, 3), 255, np.uint8)
    assert read_label(blank, Box(0, 0, 300, 80)).text == ""
    rng = np.random.default_rng(1)
    noise = rng.integers(0, 255, (80, 300, 3), dtype=np.uint8)
    reading = read_label(noise, Box(0, 0, 300, 80))
    assert reading.text == "" or reading.confidence < 0.4


def test_una_zona_demasiado_pequena_no_se_lee() -> None:
    assert read_label(np.full((10, 10, 3), 255, np.uint8), Box(0, 0, 10, 10)).text == ""


def test_clean_une_lineas_y_quita_restos_sin_letras() -> None:
    assert clean(["|", "Validar", "pago", "—", "", "  "]) == "Validar pago"
    assert clean(["Emitir", "factura\n"]) == "Emitir factura"
