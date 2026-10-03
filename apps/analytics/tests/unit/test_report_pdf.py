"""Reporte PDF (feature 008, T034): se lee el PDF generado con `pypdf`."""

import io
import json
import re
from pathlib import Path
from typing import Any

import pytest
from PIL import Image
from pypdf import PdfReader

from analytics.reports.pdf import UNAVAILABLE, Report, render_html, render_report
from analytics.reports.schemas import ExportInputFile

EXAMPLES = Path(__file__).parents[1] / "contract" / "examples" / "export"
DIAGRAM_ID = "66f100000000000000000001"


def example(name: str = "input-file") -> dict[str, Any]:
    data: dict[str, Any] = json.loads((EXAMPLES / f"{name}.json").read_text("utf-8"))
    return data


def diagram_image() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (1600, 900), (255, 255, 255)).save(output, format="WEBP")
    return output.getvalue()


IMAGES: dict[str, bytes | None] = {DIAGRAM_ID: diagram_image()}


def render(data: dict[str, Any], images: dict[str, bytes | None] | None = None) -> Report:
    return render_report(ExportInputFile.model_validate(data), IMAGES if images is None else images)


class Loose(str):
    """Texto extraído de un PDF, comparado sin espacios.

    Según la fuente instalada, el kerning hace que `pypdf` parta palabras («T odos»), así que las
    búsquedas ignoran los espacios del texto y de lo buscado.
    """

    def __new__(cls, text: str) -> "Loose":
        return super().__new__(cls, re.sub(r"\s+", "", text))

    def __contains__(self, needle: object) -> bool:
        return isinstance(needle, str) and super().__contains__(re.sub(r"\s+", "", needle))

    def occurrences(self, needle: str) -> int:
        return super().count(re.sub(r"\s+", "", needle))

    def after(self, needle: str) -> "Loose":
        return Loose(self[super().index(re.sub(r"\s+", "", needle)) :])


def pages_of(report: Report) -> list[Loose]:
    return [Loose(page.extract_text()) for page in PdfReader(io.BytesIO(report.pdf)).pages]


def text_of(report: Report) -> Loose:
    return Loose("".join(pages_of(report)))


def with_stage(data: dict[str, Any], stage: str, result: dict[str, Any]) -> dict[str, Any]:
    analysis = data["analysis"]
    stages = {**analysis["stages"], stage: result}
    return {
        **data,
        "analysis": {
            **analysis,
            "stages": stages,
            "results": {**analysis["results"], "stages": stages},
        },
    }


@pytest.fixture(scope="module")
def full() -> Report:
    return render(example())


def test_es_un_pdf_con_sus_seis_secciones(full: Report) -> None:
    assert full.pdf.startswith(b"%PDF")
    pages = pages_of(full)
    assert full.pages == len(pages) >= 6
    text = Loose("".join(pages))
    for title in (
        "Reporte del levantamiento de requisitos",
        "Resumen",
        "Diagramas",
        "Distribuciones",
        "Hallazgos",
        "Anexo: requisitos por actividad",
    ):
        assert title in text
    # Portada: proyecto, fecha en la zona del proyecto, filtros y número de detalles.
    assert "Tienda demo" in pages[0]
    assert "3 de octubre de 2026, 10:00" in pages[0]
    assert "Estados: Pendiente, Validado" in pages[0]
    assert "Diagramas: Todos" in pages[0]
    assert "Requisitos: 2" in pages[0]


def test_los_indicadores_son_los_del_dashboard(full: Report) -> None:
    summary = next(page for page in pages_of(full) if "Resumen" in page)
    for shown in ("2 Requisitos", "6 Participantes activos", "66,7 %", "50 %"):
        assert shown in summary
    text = text_of(full)
    for title in ("Por tipo", "Por prioridad", "Por estado", "Por actividad"):
        assert title in text


def test_cada_pagina_lleva_el_pie(full: Report) -> None:
    pages = pages_of(full)
    for number, page in enumerate(pages, start=1):
        assert f"Generado por ReqCanvas · Página {number} de {len(pages)}" in page


def test_el_anexo_lista_los_requisitos_por_actividad_sin_autor(full: Report) -> None:
    text = text_of(full)
    annex = text.after("Anexo: requisitos por actividad")
    assert "Proceso de compra" in annex
    assert "Validar pago (2)" in annex
    assert "#00000001 Dado el cliente eligió pagar con tarjeta de crédito" in annex
    assert "Cuando confirma el pago del pedido" in annex
    assert "Entonces la pasarela autoriza la transacción en menos de 3 segundos" in annex
    assert "No funcional · Must · Pendiente · Rol: Cajero · Etiquetas: pagos" in annex
    assert "3 votos · 1 comentarios" in annex
    assert "Autor" not in text


def test_los_hallazgos_citan_ids_cortos(full: Report) -> None:
    text = text_of(full)
    assert "pago · tarjeta · pasarela (1 requisitos)" in text
    assert "#00000002: 70 de 100 (Término ambiguo («rápido»)" in text
    assert "Caliente: Validar pago" in text
    assert "Cuando la etiqueta es pagos, el 90 % de los requisitos son no funcionales." in text
    assert "(confianza 90 %, lift 2,4)" in text
    assert "66f200000000000000000002" not in text
    # En el ejemplo los insights se omitieron (sin clave de API).
    assert text.occurrences(UNAVAILABLE) == 1


def test_los_insights_citan_sus_evidencias() -> None:
    text = text_of(render(with_stage(example(), "insights", {"status": "done", "durationMs": 9})))
    assert UNAVAILABLE not in text
    assert "Validar pago concentra los no funcionales" in text
    assert "Recomendación: Revisa con el equipo los tiempos de respuesta de la pasarela." in text
    assert "Evidencias: Actividad: Validar pago" in text


def test_sin_analisis_lo_indica() -> None:
    report = render(example("input-file-no-analysis"))
    text = text_of(report)
    assert text.occurrences(UNAVAILABLE) == 1
    assert "Temas" not in text


@pytest.mark.parametrize("status", ["failed", "skipped"])
def test_una_etapa_fallida_u_omitida_lo_indica_en_su_parte(status: str) -> None:
    result = {"status": status, "error": "X"} if status == "failed" else {"status": status}
    text = text_of(render(with_stage(example(), "topics", result)))
    assert text.occurrences(UNAVAILABLE) == 2
    assert "pago · tarjeta · pasarela" not in text
    assert "Caliente: Validar pago" in text


def test_sin_detalles_las_secciones_lo_indican() -> None:
    data = example("input-file-no-analysis")
    kpis = {
        "totalDetails": 0,
        "activeParticipants": 0,
        "coveredActivitiesPct": 0,
        "validatedPct": 0,
    }
    empty = {
        **data,
        "details": [],
        "descriptive": {
            **{key: [] for key in data["descriptive"]},
            "kpis": kpis,
        },
    }
    text = text_of(render(empty))
    assert text.occurrences("No hay requisitos con estos filtros.") == 3
    assert text.occurrences("Sin datos") == 4
    assert "Requisitos: 0" in text


def test_el_texto_de_los_detalles_se_escapa() -> None:
    data = example()
    hostile = '<script>alert(1)</script><img src="http://example.com/x.png">'
    details = [
        {**data["details"][0], "then": hostile, "given": "{{ 7 * 7 }}"},
        *data["details"][1:],
    ]
    parsed = ExportInputFile.model_validate({**data, "details": details})
    html = render_html(parsed, IMAGES)
    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    text = text_of(render_report(parsed, IMAGES))
    assert "<script>alert(1)</script><img" in text
    assert "{{ 7 * 7 }}" in text


def test_un_diagrama_sin_imagen_usa_un_marcador() -> None:
    report = render(example(), {DIAGRAM_ID: None})
    assert "No se pudo obtener la imagen del diagrama." in text_of(report)
    assert render(example(), {}).pages >= 6


def test_los_huerfanos_y_los_filtros_se_muestran() -> None:
    data = example()
    orphan = {**data["details"][0], "id": "66f2000000000000000000aa", "activityKey": "ya-no-existe"}
    filters = {
        "diagramIds": [DIAGRAM_ID],
        "from": "2026-10-01",
        "to": None,
        "types": ["functional", "constraint"],
        "statuses": ["validated"],
    }
    text = text_of(render({**data, "details": [*data["details"], orphan], "filters": filters}))
    assert "(huérfano) (1)" in text
    assert "Diagramas: Proceso de compra" in text
    assert "Periodo: Desde el 2026-10-01" in text
    assert "Tipos: Funcional, Restricción" in text


def test_dos_mil_detalles_generan_el_pdf() -> None:
    data = example("input-file-no-analysis")
    base = data["details"][0]
    activities = data["diagrams"][0]["activities"]
    details = [
        {
            **base,
            "id": f"66f2{index:020x}",
            "activityKey": activities[index % len(activities)]["key"],
            "given": f"el cliente tiene el pedido {index} listo para pagar en la tienda",
        }
        for index in range(2000)
    ]
    report = render({**data, "details": details})
    assert report.pages > 20
    assert "Requisitos: 2000" in pages_of(report)[0]
