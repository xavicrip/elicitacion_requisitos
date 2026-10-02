"""Grupos de requisitos semánticamente similares y su mapa en dos dimensiones (research R4).

Más finos que los temas: HDBSCAN con grupos de al menos 3 detalles sobre la misma reducción. El
representante de cada grupo es el detalle más cercano a su centro; la proyección 2D sirve para
el gráfico de dispersión.
"""

from typing import Any

import numpy as np
from sklearn.cluster import HDBSCAN

from analytics.mining.embeddings import embeddings, project, reduced
from analytics.mining.preprocess import analyze
from analytics.mining.run import TECHNIQUES, Context

MIN_GROUP = 3


def clusters(context: Context) -> dict[str, Any]:
    docs = analyze(context)
    vectors = embeddings(context)
    labels = HDBSCAN(min_cluster_size=MIN_GROUP).fit_predict(reduced(context))
    members: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        if label >= 0:
            members.setdefault(int(label), []).append(index)

    ordered = sorted(members.items(), key=lambda item: (-len(item[1]), item[0]))
    group_of: dict[int, str] = {}
    groups = []
    for position, (_, indexes) in enumerate(ordered):
        group_id = f"g{position}"
        centre = vectors[indexes].mean(axis=0)
        representative = indexes[int(np.argmax(vectors[indexes] @ centre))]
        groups.append(
            {
                "id": group_id,
                "detailIds": [docs[index].id for index in indexes],
                "representativeId": docs[representative].id,
            }
        )
        for index in indexes:
            group_of[index] = group_id

    plane = project(vectors, 2)
    return {
        "groups": groups,
        "points": [
            {
                "detailId": doc.id,
                "x": round(float(plane[index][0]), 4),
                "y": round(float(plane[index][1]), 4),
                "groupId": group_of.get(index),
            }
            for index, doc in enumerate(docs)
        ],
    }


TECHNIQUES["clusters"] = clusters
