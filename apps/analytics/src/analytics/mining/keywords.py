"""Palabras y frases clave por actividad y nube de palabras (research R3, FR-005).

c-TF-IDF: cada actividad es una "clase" y sus términos se ponderan por lo distintivos que son
frente a las demás actividades, no por su frecuencia absoluta.
"""

import math
from collections import Counter, defaultdict
from typing import Any

from analytics.mining.preprocess import analyze, ngrams
from analytics.mining.run import TECHNIQUES, Context

TOP_PER_ACTIVITY = 15
WORD_CLOUD_SIZE = 100


def class_tfidf(classes: dict[str, Counter[str]]) -> dict[str, list[tuple[str, float]]]:
    """Términos de cada clase ordenados por c-TF-IDF (`tf · log(1 + A / f)`)."""
    totals = {name: sum(counts.values()) for name, counts in classes.items()}
    populated = [total for total in totals.values() if total]
    if not populated:
        return {name: [] for name in classes}
    average = sum(populated) / len(populated)
    overall: Counter[str] = Counter()
    for counts in classes.values():
        overall.update(counts)
    ranked: dict[str, list[tuple[str, float]]] = {}
    for name, counts in classes.items():
        scores = [
            (term, (count / totals[name]) * math.log(1 + average / overall[term]))
            for term, count in counts.items()
        ]
        ranked[name] = sorted(scores, key=lambda item: (-item[1], item[0]))
    return ranked


def keywords(context: Context) -> dict[str, Any]:
    docs = analyze(context)
    by_activity: dict[str, Counter[str]] = defaultdict(Counter)
    cloud: Counter[str] = Counter()
    for doc in docs:
        by_activity[doc.activity_key].update(ngrams(doc.lemmas))
        cloud.update(doc.lemmas)
    ranked = class_tfidf(by_activity)
    return {
        "byActivity": [
            {
                "activityKey": key,
                "terms": [
                    {"term": term, "weight": round(weight, 4)}
                    for term, weight in ranked[key][:TOP_PER_ACTIVITY]
                ],
            }
            for key in sorted(by_activity)
        ],
        "wordCloud": [
            {"term": term, "weight": count}
            for term, count in sorted(cloud.items(), key=lambda item: (-item[1], item[0]))[
                :WORD_CLOUD_SIZE
            ]
        ],
    }


TECHNIQUES["keywords"] = keywords
