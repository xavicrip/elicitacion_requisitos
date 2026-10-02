"""Resumen de hallazgos en lenguaje natural con Claude (research R10, FR-012).

Al modelo se le envía un resumen compacto de los resultados, con identificadores de evidencia, y
los detalles más votados (sin autor). Devuelve entre 3 y 10 hallazgos con salida estructurada;
cada uno debe citar evidencias que existan y cifras que cuadren con los datos, o se descarta
(SC-006: el 100 % de los insights enlaza a datos que lo sustentan). Sin clave, la etapa se omite.
"""

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Literal

import anthropic
from pydantic import BaseModel, Field

from analytics.mining.run import TECHNIQUES, Context, SkipStage

logger = logging.getLogger("analytics.mining.insights")

DEFAULT_MODEL = "claude-opus-5-5"
MIN_INSIGHTS, MAX_INSIGHTS = 3, 10
MAX_DETAILS = 200
#: Margen en puntos porcentuales entre una cifra del texto y la de los datos.
TOLERANCE = 2.0
_PERCENT = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")

EvidenceKind = Literal["detail", "activity", "topic", "rule", "quality", "kpi"]


@dataclass(frozen=True)
class InsightsSettings:
    api_key: str
    model: str
    timeout_s: float = 60

    @classmethod
    def from_env(cls) -> "InsightsSettings | None":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return None
        return cls(api_key=api_key, model=os.environ.get("INSIGHTS_LLM_MODEL") or DEFAULT_MODEL)


class EvidenceRef(BaseModel):
    kind: EvidenceKind
    id: str


class InsightDraft(BaseModel):
    title: str = Field(description="Título corto del hallazgo, en español")
    statement: str = Field(description="Afirmación con sus cifras, en español")
    recommendation: str = Field(description="Acción concreta para el equipo, en español")
    evidence: list[EvidenceRef] = Field(description="Identificadores de la lista de evidencias")


class InsightDrafts(BaseModel):
    insights: list[InsightDraft]


PROMPT = """Eres analista de requisitos. Estos son los resultados del análisis de los requisitos \
levantados en un proyecto (escenarios Dado/Cuando/Entonces sobre actividades de un diagrama):

{summary}

Escribe entre 3 y 10 hallazgos en español para quien dirige el levantamiento. Cada hallazgo:
- afirma algo concreto que se deduzca de estos datos, con sus cifras tal como aparecen aquí \
(no calcules porcentajes nuevos ni los redondees de otra forma);
- propone una recomendación accionable;
- cita en `evidence` al menos un identificador de los que aparecen en los datos, con su `kind` \
(`kpi`, `activity`, `topic`, `rule`, `quality` o `detail`); si el hallazgo da un porcentaje, \
cita la evidencia de la que sale esa cifra.
No inventes datos ni menciones personas.{avoid}{retry}"""


def _percent(part: float, total: float) -> float:
    return round(100 * part / total, 1) if total else 0.0


Figures = dict[tuple[str, str], set[float]]


def summarize(context: Context) -> tuple[dict[str, Any], dict[str, set[str]], Figures]:
    """Resumen para el modelo, los identificadores válidos y las cifras de cada evidencia."""
    details = context.data.details
    sections = context.sections
    total = len(details)
    labels = {activity.key: activity.label for activity in context.data.activities}
    valid: dict[str, set[str]] = {
        kind: set() for kind in ("detail", "activity", "topic", "rule", "quality", "kpi")
    }
    figures: Figures = {}

    def share(kind: str, ref: str, part: float, whole: float = total) -> float:
        value = _percent(part, whole)
        figures.setdefault((kind, ref), set()).add(value)
        return value

    by_type: dict[str, int] = {}
    by_activity: dict[str, int] = {}
    for detail in details:
        by_type[detail.type] = by_type.get(detail.type, 0) + 1
        by_activity[detail.activityKey] = by_activity.get(detail.activityKey, 0) + 1
    kpis: dict[str, Any] = {"total_details": {"value": total}}
    for name, count in sorted(by_type.items()):
        key = f"type:{name}"
        kpis[key] = {"count": count, "percent": share("kpi", key, count)}
    validated = sum(1 for detail in details if detail.status == "validated")
    kpis["status:validated"] = {
        "count": validated,
        "percent": share("kpi", "status:validated", validated),
    }
    covered = len(by_activity)
    kpis["covered_activities"] = {
        "count": covered,
        "percent": share("kpi", "covered_activities", covered, len(labels) or 1),
    }
    valid["kpi"] = set(kpis)

    activities = [
        {
            "id": key,
            "name": label,
            "details": by_activity.get(key, 0),
            "percent": share("activity", key, by_activity.get(key, 0)),
        }
        for key, label in labels.items()
    ]
    valid["activity"] = set(labels)

    summary: dict[str, Any] = {"kpis": kpis, "activities": activities}

    topics = sections.get("topics") or []
    summary["topics"] = [
        {
            "id": topic["id"],
            "label": topic["label"],
            "details": len(topic["detailIds"]),
            "percent": share("topic", topic["id"], len(topic["detailIds"])),
            "activities": [labels.get(key, key) for key in topic["activityKeys"][:3]],
        }
        for topic in topics
    ]
    valid["topic"] = {topic["id"] for topic in topics}

    rules = sections.get("association") or []
    summary["rules"] = [
        {
            "id": str(index),
            "sentence": rule["sentence"],
            "percent": share("rule", str(index), rule["confidence"], 1),
        }
        for index, rule in enumerate(rules[:15])
    ]
    valid["rule"] = {rule["id"] for rule in summary["rules"]}

    quality = sections.get("quality") or []
    flagged = [item for item in quality if item["issues"]]
    worst = sorted(flagged, key=lambda item: (item["score"], item["detailId"]))[:10]
    summary["quality"] = {
        "with_issues": {
            "count": len(flagged),
            "percent": share("kpi", "quality:with_issues", len(flagged), len(quality) or 1),
        },
        "worst": [
            {
                "id": item["detailId"],
                "score": item["score"],
                "issues": sorted({issue["code"] for issue in item["issues"]}),
            }
            for item in worst
        ],
    }
    valid["kpi"].add("quality:with_issues")
    valid["quality"] = {item["detailId"] for item in quality}

    summary["duplicates"] = {"pairs": len(sections.get("duplicates") or [])}
    summary["critical_activities"] = [
        {
            "id": item["activityKey"],
            "name": labels.get(item["activityKey"]),
            "class": item["class"],
            "reason": item["reason"],
        }
        for item in sections.get("hotcold") or []
        if item["class"] != "normal"
    ]
    negatives = (sections.get("sentiment") or {}).get("mostNegative") or []
    summary["negative_details"] = [item["detailId"] for item in negatives]

    chosen = sorted(details, key=lambda detail: (-detail.voteCount, detail.id))[:MAX_DETAILS]
    summary["details"] = [
        {
            "id": detail.id,
            "activity": labels.get(detail.activityKey, detail.activityKey),
            "type": detail.type,
            "votes": detail.voteCount,
            "text": f"Dado {detail.given}, cuando {detail.when}, entonces {detail.then}",
        }
        for detail in chosen
    ]
    valid["detail"] = {detail.id for detail in details}
    return summary, valid, figures


def verify(
    drafts: list[InsightDraft], valid: dict[str, set[str]], figures: Figures
) -> tuple[list[InsightDraft], list[str]]:
    """Insights cuyas evidencias existen y cuyas cifras cuadran; y los títulos descartados.

    Cada porcentaje del texto debe coincidir (±2 puntos) con una cifra de las evidencias que el
    propio hallazgo cita: no basta con que exista esa cifra en algún otro dato.
    """
    kept: list[InsightDraft] = []
    dropped: list[str] = []
    for draft in drafts:
        evidence_ok = bool(draft.evidence) and all(
            ref.id in valid.get(ref.kind, set()) for ref in draft.evidence
        )
        known = {
            value for ref in draft.evidence for value in figures.get((ref.kind, ref.id), set())
        }
        cited = [float(value.replace(",", ".")) for value in _PERCENT.findall(draft.statement)]
        figures_ok = all(any(abs(value - other) <= TOLERANCE for other in known) for value in cited)
        if evidence_ok and figures_ok and draft.title.strip() and draft.statement.strip():
            kept.append(draft)
        else:
            dropped.append(draft.title)
    return kept[:MAX_INSIGHTS], dropped


def _ask(client: Any, settings: InsightsSettings, prompt: str) -> list[InsightDraft]:
    response = client.beta.messages.parse(
        model=settings.model,
        max_tokens=16000,
        # Una negativa por política se reintenta en otro modelo en la misma llamada.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_format=InsightDrafts,
        messages=[{"role": "user", "content": prompt}],
        timeout=settings.timeout_s,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise RuntimeError("refusal")
    drafts: list[InsightDraft] = response.parsed_output.insights
    return drafts


def insights(
    context: Context, settings: InsightsSettings | None = None, client: Any = None
) -> list[dict[str, Any]]:
    settings = settings or InsightsSettings.from_env()
    if settings is None or not settings.api_key:
        raise SkipStage("NO_API_KEY")
    api = client or anthropic.Anthropic(api_key=settings.api_key, max_retries=1)
    summary, valid, figures = summarize(context)
    rejected = context.job.settings.rejectedInsights
    avoid = (
        "\nEl equipo marcó como no útiles hallazgos como estos; evita repetirlos:\n"
        + "\n".join(f"- {text}" for text in rejected)
        if rejected
        else ""
    )
    data = json.dumps(summary, ensure_ascii=False)

    kept, dropped = verify(
        _ask(api, settings, PROMPT.format(summary=data, avoid=avoid, retry="")), valid, figures
    )
    if len(kept) < MIN_INSIGHTS:
        # Un solo reintento, indicando qué se descartó (plan, ajuste 14).
        retry = (
            "\nEn un intento anterior se descartaron estos hallazgos porque citaban evidencias "
            "inexistentes o cifras que no cuadran con los datos:\n"
            + "\n".join(f"- {title}" for title in dropped)
            + "\nUsa solo identificadores y cifras de los datos."
        )
        again, _ = verify(
            _ask(api, settings, PROMPT.format(summary=data, avoid=avoid, retry=retry)),
            valid,
            figures,
        )
        if len(again) > len(kept):
            kept = again
    context.extra["insightsFewerThanExpected"] = len(kept) < MIN_INSIGHTS
    logger.info("insights generados", extra={"kept": len(kept), "dropped": len(dropped)})
    return [
        {
            "id": f"i{index + 1}",
            "title": draft.title.strip(),
            "statement": draft.statement.strip(),
            "recommendation": draft.recommendation.strip(),
            "evidence": [ref.model_dump() for ref in draft.evidence],
        }
        for index, draft in enumerate(kept)
    ]


TECHNIQUES["insights"] = insights
