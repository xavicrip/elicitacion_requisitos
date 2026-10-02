"""Embeddings multilingües de los detalles (research R4).

`paraphrase-multilingual-MiniLM-L12-v2` (384 dimensiones, rápido en CPU). Los vectores salen
normalizados, así que el producto escalar es la similitud coseno. Los temas y los grupos
trabajan sobre una reducción UMAP a 5 dimensiones, con semilla fija para que el resultado sea
reproducible.
"""

from functools import lru_cache
from typing import Any

import numpy as np
from numpy.typing import NDArray

from analytics.mining.preprocess import analyze
from analytics.mining.run import Context

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
SEED = 42

Vectors = NDArray[np.float32]


@lru_cache(maxsize=1)
def model() -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL)


def encode(texts: list[str]) -> Vectors:
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    vectors: Vectors = model().encode(
        texts, normalize_embeddings=True, batch_size=64, show_progress_bar=False
    )
    return vectors


def embeddings(context: Context) -> Vectors:
    """Un vector por detalle (texto completo), en el orden de los documentos."""
    cached = context.shared.get("embeddings")
    if cached is None:
        cached = encode([doc.text for doc in analyze(context)])
        context.shared["embeddings"] = cached
    vectors: Vectors = cached
    return vectors


def project(vectors: Vectors, dimensions: int) -> Vectors:
    """Reducción UMAP (coseno) a `dimensions`, reproducible."""
    import umap

    reducer = umap.UMAP(
        n_neighbors=min(15, len(vectors) - 1),
        n_components=dimensions,
        min_dist=0.0 if dimensions > 2 else 0.1,
        metric="cosine",
        random_state=SEED,
    )
    projected: Vectors = reducer.fit_transform(vectors)
    return projected


def reduced(context: Context) -> Vectors:
    """Reducción a 5 dimensiones que comparten los temas y los grupos."""
    cached = context.shared.get("reduced")
    if cached is None:
        cached = project(embeddings(context), 5)
        context.shared["reduced"] = cached
    vectors: Vectors = cached
    return vectors
