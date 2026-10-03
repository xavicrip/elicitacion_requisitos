"""Reporte PDF del levantamiento (feature 008, research R5; contracts/export-formats.md).

Jinja2 con autoescape (el texto de los detalles sale siempre literal) y WeasyPrint, sin
navegador. El worker no recalcula nada: los indicadores son los de `descriptive`, que `api`
calculó con los mismos filtros que el dashboard (SC-004). Las imágenes van incrustadas y
WeasyPrint no puede descargar ningún recurso externo.
"""

import base64
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from analytics.mining.schemas import InputDetail, Stage
from analytics.reports.charts import bar_chart
from analytics.reports.coverage_image import Zone, coverage_png, heat_scale
from analytics.reports.schemas import Analysis, Count, Diagram, ExportInputFile

TEMPLATES = Path(__file__).parent / "templates"
UNAVAILABLE = "Análisis no disponible en el momento de generar el reporte"
ORPHAN_ACTIVITY = "(huérfano)"
TOP = 10

TYPE_LABEL = {
    "functional": "Funcional",
    "non_functional": "No funcional",
    "business_rule": "Regla de negocio",
    "constraint": "Restricción",
}
PRIORITY_LABEL = {"must": "Must", "should": "Should", "could": "Could", "wont": "Won't"}
STATUS_LABEL = {
    "pending": "Pendiente",
    "validated": "Validado",
    "duplicate": "Duplicado",
    "discarded": "Descartado",
}
ISSUE_LABEL = {
    "ambiguous_term": "Término ambiguo",
    "not_measurable": "No medible",
    "too_short": "Demasiado corto",
    "missing_verb": "Sin verbo",
    "vague_reference": "Referencia vaga",
}
HEAT_LABEL = {"hot": "Caliente", "cold": "Fría"}
EVIDENCE_LABEL = {
    "detail": "Requisito",
    "activity": "Actividad",
    "topic": "Tema",
    "rule": "Regla",
    "quality": "Calidad",
    "kpi": "Indicador",
}
MONTHS = (
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre"
).split()


@dataclass(frozen=True)
class Report:
    pdf: bytes
    pages: int


def short_id(identifier: str) -> str:
    """ID corto de las exportaciones: los 8 últimos caracteres (como CSV, Excel y Gherkin)."""
    return identifier[-8:]


def _number(value: float) -> str:
    return f"{value:g}".replace(".", ",")


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _moment(iso: str, zone: ZoneInfo) -> str:
    try:
        moment = datetime.fromisoformat(iso)
    except ValueError:
        return iso
    local = (moment if moment.tzinfo else moment.replace(tzinfo=UTC)).astimezone(zone)
    return f"{local.day} de {MONTHS[local.month - 1]} de {local.year}, {local:%H:%M}"


def _filters(data: ExportInputFile) -> list[tuple[str, str]]:
    filters = data.filters
    names = {diagram.id: diagram.name for diagram in data.diagrams}
    if filters.diagramIds is None:
        diagrams = "Todos"
    else:
        diagrams = ", ".join(names.get(item, short_id(item)) for item in filters.diagramIds)
    if filters.from_ and filters.to:
        period = f"Del {filters.from_} al {filters.to}"
    elif filters.from_:
        period = f"Desde el {filters.from_}"
    elif filters.to:
        period = f"Hasta el {filters.to}"
    else:
        period = "Todo el periodo"
    types = (
        "Todos" if filters.types is None else ", ".join(TYPE_LABEL[item] for item in filters.types)
    )
    return [
        ("Diagramas", diagrams or "Ninguno"),
        ("Periodo", period),
        ("Tipos", types or "Ninguno"),
        ("Estados", ", ".join(STATUS_LABEL[item] for item in filters.statuses)),
    ]


def _chart(counts: list[Count]) -> Markup:
    return bar_chart([(count.label, count.count) for count in counts])


def _diagram(diagram: Diagram, image: bytes | None) -> dict[str, Any]:
    zones = [
        Zone(a.bbox.x, a.bbox.y, a.bbox.w, a.bbox.h, a.detailCount) for a in diagram.activities
    ]
    png = coverage_png(image, diagram.image.width, diagram.image.height, zones)
    return {
        "name": diagram.name,
        "src": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
        "legend": heat_scale([zone.count for zone in zones]).legend,
        "activities": len(diagram.activities),
        "missing": image is None,
    }


def _detail(detail: InputDetail) -> dict[str, Any]:
    meta = [TYPE_LABEL[detail.type]]
    if detail.priority:
        meta.append(PRIORITY_LABEL[detail.priority])
    meta.append(STATUS_LABEL[detail.status])
    if detail.authorRole:
        meta.append(f"Rol: {detail.authorRole}")
    if detail.tags:
        meta.append("Etiquetas: " + ", ".join(detail.tags))
    meta.append(f"{detail.voteCount} votos")
    meta.append(f"{detail.commentCount} comentarios")
    return {
        "id": short_id(detail.id),
        "given": detail.given,
        "when": detail.when,
        "then": detail.then,
        "meta": " · ".join(meta),
    }


def _annex(data: ExportInputFile) -> list[dict[str, Any]]:
    """Los requisitos por diagrama y actividad, en el orden del diagrama."""
    grouped: dict[tuple[str, str], list[InputDetail]] = {}
    for detail in data.details:
        grouped.setdefault((detail.diagramId, detail.activityKey), []).append(detail)

    def activity(label: str, details: list[InputDetail]) -> dict[str, Any]:
        return {"label": label, "details": [_detail(detail) for detail in details]}

    sections: list[dict[str, Any]] = []
    for diagram in data.diagrams:
        activities = [
            activity(item.label, grouped.pop((diagram.id, item.key)))
            for item in diagram.activities
            if (diagram.id, item.key) in grouped
        ]
        # Detalles de actividades que ya no están en la versión publicada.
        for key in [key for key in grouped if key[0] == diagram.id]:
            activities.append(activity(ORPHAN_ACTIVITY, grouped.pop(key)))
        if activities:
            sections.append({"name": diagram.name, "activities": activities})
    if grouped:
        rest = [activity(ORPHAN_ACTIVITY, details) for details in grouped.values()]
        sections.append({"name": "Diagrama no disponible", "activities": rest})
    return sections


def _findings(data: ExportInputFile, analysis: Analysis) -> dict[str, Any]:
    """Los hallazgos del último análisis; `None` en la parte omitida o fallida."""
    results = analysis.results
    labels = {a.key: a.label for diagram in data.diagrams for a in diagram.activities}
    topics = {topic.id: topic.label for topic in results.topics or []}

    def done(stage: Stage) -> bool:
        result = analysis.stages.get(stage)
        return result is not None and result.status == "done"

    def evidence(kind: str, identifier: str) -> str:
        if kind == "detail":
            shown = f"#{short_id(identifier)}"
        elif kind == "activity":
            shown = labels.get(identifier, identifier)
        elif kind == "topic":
            shown = topics.get(identifier, identifier)
        else:
            shown = identifier
        return f"{EVIDENCE_LABEL[kind]}: {shown}"

    found: dict[str, Any] = {
        "topics": None,
        "quality": None,
        "heat": None,
        "rules": None,
        "insights": None,
    }
    if done("topics") and results.topics is not None:
        found["topics"] = [
            {"label": topic.label, "count": len(topic.detailIds)} for topic in results.topics
        ]
    if done("quality") and results.quality is not None:
        worst = sorted(results.quality, key=lambda item: item.score)[:TOP]
        found["quality"] = [
            {
                "id": short_id(item.detailId),
                "score": item.score,
                "issues": [
                    ISSUE_LABEL[issue.code] + (f" («{issue.term}»)" if issue.term else "")
                    for issue in item.issues
                ],
            }
            for item in worst
        ]
    if done("hotcold") and results.hotcold is not None:
        found["heat"] = [
            {
                "activity": labels.get(item.activityKey, item.activityKey),
                "kind": HEAT_LABEL[item.class_],
                "reason": item.reason,
            }
            for item in results.hotcold
            if item.class_ != "normal"
        ]
    if done("association") and results.association is not None:
        rules = sorted(results.association, key=lambda rule: rule.lift, reverse=True)[:TOP]
        found["rules"] = [
            {
                "sentence": rule.sentence,
                "confidence": _number(round(rule.confidence * 100)),
                "lift": _number(round(rule.lift, 2)),
            }
            for rule in rules
        ]
    if done("insights") and results.insights is not None:
        found["insights"] = [
            {
                "title": insight.title,
                "statement": insight.statement,
                "recommendation": insight.recommendation,
                "evidence": [evidence(item.kind, item.id) for item in insight.evidence],
            }
            for insight in results.insights
        ]
    return found


def build_context(data: ExportInputFile, images: Mapping[str, bytes | None]) -> dict[str, Any]:
    zone = _zone(data.project.timezone)
    kpis = data.descriptive.kpis
    return {
        "project": data.project.name,
        "generated_at": _moment(data.generatedAt, zone),
        "filters": _filters(data),
        "detail_count": len(data.details),
        "kpis": [
            ("Requisitos", _number(kpis.totalDetails)),
            ("Participantes activos", _number(kpis.activeParticipants)),
            ("Actividades cubiertas", f"{_number(kpis.coveredActivitiesPct)} %"),
            ("Requisitos validados", f"{_number(kpis.validatedPct)} %"),
        ],
        "diagrams": [_diagram(diagram, images.get(diagram.id)) for diagram in data.diagrams],
        "charts": [
            ("Por tipo", _chart(data.descriptive.byType)),
            ("Por prioridad", _chart(data.descriptive.byPriority)),
            ("Por estado", _chart(data.descriptive.byStatus)),
            ("Por actividad", _chart(data.descriptive.byActivity)),
        ],
        "analysis_at": _moment(data.analysis.finishedAt, zone) if data.analysis else None,
        "findings": _findings(data, data.analysis) if data.analysis else None,
        "unavailable": UNAVAILABLE,
        "annex": _annex(data),
    }


def render_html(data: ExportInputFile, images: Mapping[str, bytes | None]) -> str:
    environment = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=select_autoescape(default=True, default_for_string=True),
    )
    css = Markup((TEMPLATES / "report.css").read_text(encoding="utf-8"))  # noqa: S704 - propio
    template = environment.get_template("report.html.j2")
    return template.render(css=css, **build_context(data, images))


def render_report(data: ExportInputFile, images: Mapping[str, bytes | None]) -> Report:
    """Genera el PDF; `images` lleva la imagen de cada diagrama (`None` si no se pudo bajar)."""
    # Se importa aquí: WeasyPrint carga Pango al importarse y el worker debe arrancar sin él.
    from weasyprint import HTML
    from weasyprint.urls import URLFetcher

    document = HTML(
        string=render_html(data, images),
        # Solo recursos incrustados: el reporte no descarga nada.
        url_fetcher=URLFetcher(allowed_protocols=["data"]),
    ).render()
    pdf = document.write_pdf()
    assert pdf is not None
    return Report(pdf=pdf, pages=len(document.pages))
