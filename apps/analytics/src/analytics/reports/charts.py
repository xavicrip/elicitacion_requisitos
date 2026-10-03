"""Gráficos del reporte PDF (feature 008, research R5): barras en SVG, sin matplotlib.

WeasyPrint incrusta el SVG tal cual; los colores son los de la paleta del dashboard
(`apps/web/src/features/dashboard/charts/theme.ts`).
"""

from collections.abc import Sequence

from markupsafe import Markup, escape

SERIES = "#2a78d6"
TEXT = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"

WIDTH = 520
ROW = 22
LABEL_WIDTH = 190
VALUE_WIDTH = 44
MAX_LABEL = 34


def _shorten(label: str) -> str:
    return label if len(label) <= MAX_LABEL else f"{label[: MAX_LABEL - 1]}…"


def bar_chart(items: Sequence[tuple[str, float]], color: str = SERIES) -> Markup:
    """Barras horizontales: una por categoría, con su etiqueta a la izquierda y su valor."""
    if not items:
        return Markup(  # noqa: S704 - sin texto externo
            f'<svg xmlns="http://www.w3.org/2000/svg" class="chart" width="{WIDTH}" '
            f'height="{ROW}" viewBox="0 0 {WIDTH} {ROW}"><text x="0" y="15" font-size="11" '
            f'fill="{TEXT_SECONDARY}">Sin datos</text></svg>'
        )
    top = max(max(value for _, value in items), 0) or 1
    span = WIDTH - LABEL_WIDTH - VALUE_WIDTH
    height = ROW * len(items)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" class="chart" width="{WIDTH}" '
        f'height="{height}" viewBox="0 0 {WIDTH} {height}">',
        f'<line x1="{LABEL_WIDTH}" y1="0" x2="{LABEL_WIDTH}" y2="{height}" stroke="{GRID}"/>',
    ]
    for index, (label, value) in enumerate(items):
        y = index * ROW
        length = round(span * max(value, 0) / top, 1)
        shown = f"{value:g}"
        parts.append(
            f'<text x="{LABEL_WIDTH - 8}" y="{y + 15}" font-size="11" text-anchor="end" '
            f'fill="{TEXT}">{escape(_shorten(label))}</text>'
            f'<rect class="bar" x="{LABEL_WIDTH}" y="{y + 4}" width="{length}" '
            f'height="{ROW - 8}" rx="2" fill="{color}"/>'
            f'<text x="{LABEL_WIDTH + length + 6}" y="{y + 15}" font-size="11" '
            f'fill="{TEXT_SECONDARY}">{escape(shown)}</text>'
        )
    parts.append("</svg>")
    # Las etiquetas y los valores (lo único externo) pasan por `escape`.
    return Markup("".join(parts))  # noqa: S704
