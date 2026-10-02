"""Sentimiento de los detalles (research R6, FR-008).

`pysentimiento` (RoBERTuito, español) clasifica cada detalle como positivo, neutro o negativo.
El modelo está entrenado con tuits y los requisitos suelen ser neutros, así que solo se destaca
como negativo lo que supera 0,7: dolores o frustraciones expresados con claridad.
"""

from collections import Counter
from collections.abc import Callable
from functools import lru_cache
from typing import Any, Literal

from analytics.mining.preprocess import analyze
from analytics.mining.run import TECHNIQUES, Context

Label = Literal["POS", "NEU", "NEG"]
#: Clasificador: por cada texto, la probabilidad de cada etiqueta.
Classifier = Callable[[list[str]], list[dict[Label, float]]]

NEGATIVE_THRESHOLD = 0.7
POSITIVE_THRESHOLD = 0.7
TOP_NEGATIVE = 10


@lru_cache(maxsize=1)
def default_classifier() -> Classifier:
    from pysentimiento import create_analyzer

    analyzer = create_analyzer(task="sentiment", lang="es")

    def classify(texts: list[str]) -> list[dict[Label, float]]:
        return [dict(output.probas) for output in analyzer.predict(texts)]

    return classify


def sentiment(context: Context, classify: Classifier | None = None) -> dict[str, Any]:
    docs = analyze(context)
    scores = (classify or default_classifier())([doc.text for doc in docs])
    by_activity: dict[str, Counter[str]] = {}
    negatives: list[tuple[float, str]] = []
    for doc, probabilities in zip(docs, scores, strict=True):
        negative = probabilities.get("NEG", 0.0)
        if negative >= NEGATIVE_THRESHOLD:
            label = "neg"
            negatives.append((negative, doc.id))
        elif probabilities.get("POS", 0.0) >= POSITIVE_THRESHOLD:
            label = "pos"
        else:
            label = "neu"
        by_activity.setdefault(doc.activity_key, Counter())[label] += 1
    negatives.sort(key=lambda item: (-item[0], item[1]))
    # Las actividades críticas usan el malestar expresado como señal de desacuerdo.
    context.shared["negative_details"] = [detail_id for _, detail_id in negatives]
    return {
        "byActivity": [
            {"activityKey": key, "pos": counts["pos"], "neu": counts["neu"], "neg": counts["neg"]}
            for key, counts in sorted(by_activity.items())
        ],
        "mostNegative": [
            {"detailId": detail_id, "score": round(score, 3)}
            for score, detail_id in negatives[:TOP_NEGATIVE]
        ],
    }


TECHNIQUES["sentiment"] = sentiment
