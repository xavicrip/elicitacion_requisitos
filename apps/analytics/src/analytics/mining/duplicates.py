"""Pares de detalles casi duplicados (research R5, FR-007).

Dos condiciones: el texto completo es muy similar (coseno ≥ 0,85 en la misma actividad o ≥ 0,92
entre actividades) **y** lo es cada parte por separado (Dado, Cuando y Entonces ≥ 0,80). Dos
requisitos con el mismo contexto y la misma acción pero distinto resultado no son duplicados.
Los pares que el Administrador ya decidió no vuelven a proponerse.
"""

from typing import Any

import numpy as np

from analytics.mining.embeddings import embeddings, encode
from analytics.mining.run import TECHNIQUES, Context

SAME_ACTIVITY = 0.85
ACROSS_ACTIVITIES = 0.92
EACH_PART = 0.80
MAX_PAIRS = 200
_BLOCK = 1000


def duplicates(context: Context) -> list[dict[str, Any]]:
    details = context.data.details
    if len(details) < 2:
        return []
    vectors = embeddings(context)
    decided = {tuple(sorted(decision.pair)) for decision in context.data.duplicateDecisions}
    activities = np.array([detail.activityKey for detail in details])

    candidates: list[tuple[int, int, float]] = []
    for start in range(0, len(details), _BLOCK):
        block = vectors[start : start + _BLOCK] @ vectors.T
        rows, columns = np.nonzero(block >= SAME_ACTIVITY)
        for row, column in zip(rows + start, columns, strict=True):
            if row >= column:
                continue
            similarity = float(block[row - start, column])
            threshold = (
                SAME_ACTIVITY if activities[row] == activities[column] else ACROSS_ACTIVITIES
            )
            pair = tuple(sorted((details[row].id, details[column].id)))
            if similarity >= threshold and pair not in decided:
                candidates.append((int(row), int(column), similarity))
    if not candidates:
        return []

    # Solo se calculan las partes de los detalles que aparecen en algún candidato.
    involved = sorted({index for first, second, _ in candidates for index in (first, second)})
    position = {index: order for order, index in enumerate(involved)}
    parts = [
        encode([getattr(details[index], field) for index in involved])
        for field in ("given", "when", "then")
    ]
    pairs: list[tuple[float, list[str]]] = []
    for first, second, similarity in candidates:
        weakest = min(float(part[position[first]] @ part[position[second]]) for part in parts)
        if weakest >= EACH_PART:
            pairs.append(
                (round(min(similarity, 1.0), 3), sorted((details[first].id, details[second].id)))
            )
    pairs.sort(key=lambda item: (-item[0], item[1]))
    return [{"pair": pair, "similarity": similarity} for similarity, pair in pairs[:MAX_PAIRS]]


TECHNIQUES["duplicates"] = duplicates
