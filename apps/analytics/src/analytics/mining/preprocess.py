"""Preprocesamiento en español de los detalles (feature 007, research R2, FR-004).

spaCy (`es_core_news_md`) tokeniza y lematiza. De cada detalle se conservan los lemas de las
palabras con contenido (sustantivos, adjetivos y verbos), en minúsculas y sin palabras vacías:
las de spaCy, las del dominio y las que añada el proyecto. El resultado se calcula una vez por
análisis y lo comparten las demás técnicas.
"""

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from analytics.mining.run import Context

#: Palabras tan frecuentes en un requisito que no distinguen nada.
DOMAIN_STOPWORDS = frozenset(
    {"sistema", "usuario", "deber", "poder", "permitir", "realizar", "hacer", "plataforma"}
)
CONTENT_POS = frozenset({"NOUN", "PROPN", "ADJ", "VERB"})
_URL = re.compile(r"https?://\S+|www\.\S+")


@dataclass(frozen=True)
class Doc:
    id: str
    activity_key: str
    #: Texto completo: Dado, Cuando y Entonces.
    text: str
    #: Lemas de las palabras con contenido, en orden.
    lemmas: tuple[str, ...]


@lru_cache(maxsize=1)
def nlp() -> Any:
    import spacy

    return spacy.load("es_core_news_md", disable=["ner"])


def ngrams(lemmas: tuple[str, ...], longest: int = 3) -> list[str]:
    """N-gramas de 1 a `longest` lemas consecutivos."""
    return [
        " ".join(lemmas[start : start + size])
        for size in range(1, longest + 1)
        for start in range(len(lemmas) - size + 1)
    ]


def analyze(context: Context) -> list[Doc]:
    """Documentos preprocesados del análisis (en `context.shared`, calculados una sola vez)."""
    cached = context.shared.get("docs")
    if cached is not None:
        docs: list[Doc] = cached
        return docs

    extra = {word.strip().lower() for word in context.job.settings.extraStopwords}
    details = context.data.details
    texts = [_URL.sub(" ", f"{d.given}. {d.when}. {d.then}") for d in details]
    docs = []
    words = unknown = 0
    for detail, text, parsed in zip(details, texts, nlp().pipe(texts, batch_size=64), strict=True):
        lemmas: list[str] = []
        for token in parsed:
            if not token.is_alpha:
                continue
            words += 1
            unknown += token.is_oov
            lemma = token.lemma_.lower()
            if (
                token.pos_ in CONTENT_POS
                and not token.is_stop
                and len(lemma) > 2
                and lemma not in DOMAIN_STOPWORDS
                and lemma not in extra
                and token.lower_ not in extra
            ):
                lemmas.append(lemma)
        docs.append(Doc(detail.id, detail.activityKey, text, tuple(lemmas)))

    context.shared["docs"] = docs
    # Texto en otro idioma o con muchas faltas: la calidad del análisis baja y se avisa.
    context.extra["preprocess"] = {"unrecognizedRatio": round(unknown / words, 3) if words else 0}
    return docs
