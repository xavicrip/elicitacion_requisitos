"""Gráficos del reporte PDF (feature 008, T035): cobertura sobre el diagrama y barras SVG."""

import io
import xml.etree.ElementTree as ET

from PIL import Image

from analytics.reports.charts import bar_chart
from analytics.reports.coverage_image import (
    MAX_WIDTH,
    PLACEHOLDER_BACKGROUND,
    Zone,
    coverage_png,
    heat_scale,
    render_coverage,
)

SVG = "{http://www.w3.org/2000/svg}"


def diagram(width: int = 800, height: int = 400) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(output, format="WEBP")
    return output.getvalue()


ZONES = [
    Zone(0.1, 0.1, 0.2, 0.2, 0),
    Zone(0.4, 0.1, 0.2, 0.2, 3),
    Zone(0.7, 0.1, 0.2, 0.2, 40),
]


def center(image: Image.Image, zone: Zone) -> tuple[int, ...]:
    pixel = image.getpixel(
        (round((zone.x + zone.w / 2) * image.width), round((zone.y + zone.h / 2) * image.height))
    )
    assert isinstance(pixel, tuple)
    return pixel


def test_la_cobertura_conserva_las_proporciones_y_colorea_cada_zona() -> None:
    image = render_coverage(diagram(), 800, 400, ZONES)
    assert image.size == (800, 400)
    colors = [center(image, zone) for zone in ZONES]
    # Tres niveles distintos: de amarillo claro (0 requisitos) a rojo (muchos).
    assert len(set(colors)) == 3
    assert colors[0][1] > colors[1][1] > colors[2][1]
    # Fuera de las zonas el diagrama no cambia.
    assert image.getpixel((5, 5)) == (255, 255, 255)


def test_un_diagrama_grande_se_reduce_sin_deformarse() -> None:
    image = render_coverage(diagram(2800, 700), 2800, 700, ZONES)
    assert image.size == (MAX_WIDTH, MAX_WIDTH // 4)


def test_sin_imagen_o_con_una_ilegible_usa_un_marcador_con_las_zonas() -> None:
    for broken in (None, b"esto no es una imagen"):
        image = render_coverage(broken, 800, 400, ZONES)
        assert image.size == (800, 400)
        assert image.getpixel((700, 380)) == PLACEHOLDER_BACKGROUND
        assert center(image, ZONES[2]) != PLACEHOLDER_BACKGROUND


def test_la_imagen_final_es_un_png() -> None:
    png = coverage_png(diagram(), 800, 400, ZONES)
    with Image.open(io.BytesIO(png)) as opened:
        assert opened.format == "PNG"
        assert opened.size == (800, 400)
    assert coverage_png(None, 800, 400, [])[:4] == b"\x89PNG"


def test_la_escala_usa_cuantiles_como_el_mapa_de_calor() -> None:
    scale = heat_scale([0, 1, 2, 3, 10, 12, 20, 40])
    assert [label for label, _ in scale.legend] == ["0–1", "2–3", "4–12", "13–40"]
    assert scale.color_of(0) == scale.color_of(1) != scale.color_of(2)
    assert scale.color_of(100) == scale.color_of(40)
    assert len({color for _, color in scale.legend}) == 4
    # Sin actividades o con todas iguales: una sola clase.
    assert [label for label, _ in heat_scale([]).legend] == ["0"]
    assert [label for label, _ in heat_scale([5, 5]).legend] == ["0–5"]


def test_las_barras_tienen_una_por_categoria_con_su_etiqueta_y_valor() -> None:
    svg = ET.fromstring(  # noqa: S314 - SVG generado por el propio módulo
        bar_chart([("Funcional", 38), ("No funcional <b>", 19), ("Restricción", 0)])
    )
    bars = svg.findall(f"{SVG}rect")
    assert len(bars) == 3
    widths = [float(bar.attrib["width"]) for bar in bars]
    assert widths[0] == 2 * widths[1] > 0
    assert widths[2] == 0
    texts = [text.text for text in svg.findall(f"{SVG}text")]
    assert texts == ["Funcional", "38", "No funcional <b>", "19", "Restricción", "0"]


def test_las_barras_acortan_las_etiquetas_largas_y_no_fallan_sin_datos() -> None:
    svg = ET.fromstring(bar_chart([("x" * 80, 1)]))  # noqa: S314
    label = svg.findall(f"{SVG}text")[0].text
    assert label is not None and len(label) == 34 and label.endswith("…")
    empty = ET.fromstring(bar_chart([]))  # noqa: S314
    assert empty.findall(f"{SVG}rect") == []
    assert [text.text for text in empty.findall(f"{SVG}text")] == ["Sin datos"]
