"""Imagen del diagrama con la cobertura (feature 008, research R5).

Sobre la imagen publicada de la 003 se colorea la zona de cada actividad según su número de
requisitos, con la escala del mapa de calor de la 004 (cuantiles, de amarillo a rojo).
"""

import io
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from PIL import Image, ImageDraw, UnidentifiedImageError

MAX_WIDTH = 1400
ALPHA = 120
PLACEHOLDER_TEXT = "Imagen del diagrama no disponible"
PLACEHOLDER_BACKGROUND = (240, 240, 238)

# ColorBrewer YlOrRd (9 clases), la rampa de `interpolateYlOrRd` de la 004.
_YL_OR_RD = [
    (255, 255, 204),
    (255, 237, 160),
    (254, 217, 118),
    (254, 178, 76),
    (253, 141, 60),
    (252, 78, 42),
    (227, 26, 28),
    (189, 0, 38),
    (128, 0, 38),
]

Color = tuple[int, int, int]


@dataclass(frozen=True)
class Zone:
    """Zona de una actividad, con coordenadas normalizadas (0–1), y sus requisitos."""

    x: float
    y: float
    w: float
    h: float
    count: int


@dataclass(frozen=True)
class HeatScale:
    color_of: Callable[[int], Color]
    #: De menos a más requisitos, con el rango de cada color.
    legend: list[tuple[str, str]]


def _ramp(t: float) -> Color:
    position = min(max(t, 0.0), 1.0) * (len(_YL_OR_RD) - 1)
    index = min(int(position), len(_YL_OR_RD) - 2)
    low, high = _YL_OR_RD[index], _YL_OR_RD[index + 1]
    share = position - index
    return (
        round(low[0] + (high[0] - low[0]) * share),
        round(low[1] + (high[1] - low[1]) * share),
        round(low[2] + (high[2] - low[2]) * share),
    )


def hex_color(color: Color) -> str:
    return "#{:02x}{:02x}{:02x}".format(*color)


def heat_scale(totals: Sequence[int]) -> HeatScale:
    """Escala por cuantiles con hasta 4 clases (como `heatmapScale` de la 004)."""
    ordered = sorted(totals)
    breaks = (
        sorted({ordered[max(0, -(-len(ordered) * q // 4) - 1)] for q in (1, 2, 3, 4)})
        if ordered
        else [0]
    )

    def color_at(index: int) -> Color:
        return _ramp(0.1 if len(breaks) == 1 else 0.1 + 0.8 * index / (len(breaks) - 1))

    def color_of(total: int) -> Color:
        index = next((i for i, upper in enumerate(breaks) if total <= upper), len(breaks) - 1)
        return color_at(index)

    legend = []
    for index, upper in enumerate(breaks):
        lower = 0 if index == 0 else breaks[index - 1] + 1
        label = str(upper) if lower == upper else f"{lower}–{upper}"
        legend.append((label, hex_color(color_at(index))))
    return HeatScale(color_of=color_of, legend=legend)


def _base(image: bytes | None, width: int, height: int) -> Image.Image:
    size = (min(width, MAX_WIDTH), max(1, round(height * min(width, MAX_WIDTH) / width)))
    if image is not None:
        try:
            with Image.open(io.BytesIO(image)) as opened:
                return opened.convert("RGB").resize(size, Image.Resampling.LANCZOS)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            pass
    # Sin imagen (no se pudo descargar o leer): un marcador con las mismas proporciones.
    placeholder = Image.new("RGB", size, PLACEHOLDER_BACKGROUND)
    ImageDraw.Draw(placeholder).text((16, 12), PLACEHOLDER_TEXT, fill=(90, 90, 86))
    return placeholder


def render_coverage(
    image: bytes | None, width: int, height: int, zones: Sequence[Zone]
) -> Image.Image:
    """La imagen del diagrama (o un marcador) con cada zona coloreada según sus requisitos."""
    base = _base(image, width, height)
    scale = heat_scale([zone.count for zone in zones])
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for zone in zones:
        left, top = zone.x * base.width, zone.y * base.height
        box = (left, top, left + zone.w * base.width, top + zone.h * base.height)
        color = scale.color_of(zone.count)
        draw.rectangle(box, fill=(*color, ALPHA), outline=(*color, 255), width=2)
    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")


def coverage_png(image: bytes | None, width: int, height: int, zones: Sequence[Zone]) -> bytes:
    output = io.BytesIO()
    render_coverage(image, width, height, zones).save(output, format="PNG", optimize=True)
    return output.getvalue()
