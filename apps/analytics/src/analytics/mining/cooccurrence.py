"""Red de términos que aparecen juntos en un mismo detalle (research R3, FR-005).

Se conservan los pares con PMI positivo (aparecen juntos más de lo esperable) y al menos tres
apariciones conjuntas; las comunidades de Louvain agrupan los términos para colorear el grafo.
"""

import math
from collections import Counter
from itertools import combinations
from typing import Any

import networkx as nx

from analytics.mining.preprocess import analyze
from analytics.mining.run import TECHNIQUES, Context

MIN_COUNT = 3
MAX_EDGES = 150


def cooccurrence(context: Context) -> dict[str, Any]:
    docs = analyze(context)
    total = len(docs)
    frequency: Counter[str] = Counter()
    pairs: Counter[tuple[str, str]] = Counter()
    for doc in docs:
        terms = sorted(set(doc.lemmas))
        frequency.update(terms)
        pairs.update(combinations(terms, 2))

    edges = []
    for (a, b), count in pairs.items():
        if count < MIN_COUNT:
            continue
        pmi = math.log2(count * total / (frequency[a] * frequency[b]))
        if pmi > 0:
            edges.append((a, b, count, pmi))
    edges.sort(key=lambda edge: (-edge[2], -edge[3], edge[0], edge[1]))
    edges = edges[:MAX_EDGES]

    graph = nx.Graph()
    graph.add_weighted_edges_from((a, b, count) for a, b, count, _ in edges)
    communities = nx.community.louvain_communities(graph, weight="weight", seed=42) if edges else []
    community_of = {
        term: index
        for index, members in enumerate(sorted(communities, key=lambda group: sorted(group)[0]))
        for term in members
    }
    return {
        "nodes": [
            {"id": term, "freq": frequency[term], "community": community_of[term]}
            for term in sorted(community_of)
        ],
        "edges": [
            {"source": a, "target": b, "pmi": round(pmi, 3), "count": count}
            for a, b, count, pmi in edges
        ],
    }


TECHNIQUES["cooccurrence"] = cooccurrence
