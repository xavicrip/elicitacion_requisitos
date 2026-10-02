"""Temas transversales de los detalles (research R4, FR-006).

La misma cadena que BERTopic, sin su envoltorio: embeddings → UMAP → HDBSCAN → c-TF-IDF de los
términos de cada grupo. Los detalles que no encajan en ningún tema quedan fuera.
"""

from collections import Counter
from typing import Any

from sklearn.cluster import HDBSCAN

from analytics.mining.embeddings import reduced
from analytics.mining.keywords import class_tfidf
from analytics.mining.preprocess import analyze, ngrams
from analytics.mining.run import TECHNIQUES, Context

TERMS_PER_TOPIC = 10


def topics(context: Context) -> list[dict[str, Any]]:
    docs = analyze(context)
    labels = HDBSCAN(min_cluster_size=max(5, len(docs) // 50)).fit_predict(reduced(context))
    members: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        if label >= 0:
            members.setdefault(int(label), []).append(index)

    terms = class_tfidf(
        {
            str(label): Counter(term for index in indexes for term in ngrams(docs[index].lemmas, 2))
            for label, indexes in members.items()
        }
    )
    ordered = sorted(members.items(), key=lambda item: (-len(item[1]), item[0]))
    result = []
    for position, (label, indexes) in enumerate(ordered):
        top = terms[str(label)][:TERMS_PER_TOPIC]
        activities = Counter(docs[index].activity_key for index in indexes)
        result.append(
            {
                "id": f"t{position}",
                "label": " · ".join(term for term, _ in top[:3]),
                "terms": [{"term": term, "weight": round(weight, 4)} for term, weight in top],
                "detailIds": [docs[index].id for index in indexes],
                "activityKeys": [key for key, _ in activities.most_common()],
            }
        )
    return result


TECHNIQUES["topics"] = topics
