"""Actividades calientes y frías (research R9, FR-011).

Por actividad se combinan, normalizados (z-score), el volumen de detalles, los votos, los
comentarios y el desacuerdo (detalles descartados o con sentimiento negativo). Caliente: muy por
encima de la media; fría: sin detalles o con muy pocos. Cada una indica su motivo.
"""

from collections import Counter
from statistics import mean, pstdev
from typing import Any

from analytics.mining.run import TECHNIQUES, Context

HOT = 1.5
COLD = -1.0
WEIGHTS = {"volumen": 0.4, "votos": 0.25, "comentarios": 0.2, "desacuerdo": 0.15}
REASONS = {
    "volumen": "muchos requisitos",
    "votos": "muchos votos",
    "comentarios": "mucha discusión en los comentarios",
    "desacuerdo": "requisitos descartados o con malestar expresado",
}


def _z(values: list[float]) -> list[float]:
    deviation = pstdev(values)
    if deviation == 0:
        return [0.0 for _ in values]
    average = mean(values)
    return [(value - average) / deviation for value in values]


def hotcold(context: Context) -> list[dict[str, Any]]:
    activities = context.data.activities
    if not activities:
        return []
    negative = set()
    stored = context.shared.get("negative_details")
    if stored:
        negative = set(stored)
    volume: Counter[str] = Counter()
    votes: Counter[str] = Counter()
    comments: Counter[str] = Counter()
    disagreement: Counter[str] = Counter()
    for detail in context.data.details:
        key = detail.activityKey
        volume[key] += 1
        votes[key] += detail.voteCount
        comments[key] += detail.commentCount
        if detail.status == "discarded" or detail.id in negative:
            disagreement[key] += 1

    keys = [activity.key for activity in activities]
    components = {
        "volumen": _z([float(volume[key]) for key in keys]),
        "votos": _z([float(votes[key]) for key in keys]),
        "comentarios": _z([float(comments[key]) for key in keys]),
        "desacuerdo": _z([disagreement[key] / volume[key] if volume[key] else 0.0 for key in keys]),
    }
    result = []
    for index, key in enumerate(keys):
        weighted = {name: WEIGHTS[name] * values[index] for name, values in components.items()}
        score = sum(weighted.values())
        if volume[key] == 0:
            kind, reason = "cold", "sin requisitos todavía"
        elif components["volumen"][index] <= COLD:
            kind, reason = "cold", "muy pocos requisitos"
        elif score >= HOT:
            dominant = max(weighted, key=lambda name: weighted[name])
            kind, reason = "hot", REASONS[dominant]
        else:
            kind, reason = "normal", "dentro de lo habitual"
        result.append(
            {"activityKey": key, "class": kind, "score": round(score, 2), "reason": reason}
        )
    return result


TECHNIQUES["hotcold"] = hotcold
