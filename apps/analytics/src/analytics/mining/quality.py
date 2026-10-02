"""Calidad de cada requisito con reglas explicables (research R7, FR-009).

Puntaje de 0 a 100: se parte de 100 y cada problema resta, con su explicación. Las reglas son
deliberadamente simples: el Administrador decide qué corregir (constitución VII).
"""

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from analytics.mining.preprocess import nlp
from analytics.mining.run import TECHNIQUES, Context

LEXICON = Path(__file__).parent / "lexicon" / "ambiguous_es.txt"
FIELDS = ("given", "when", "then")
VAGUE = frozenset({"esto", "eso", "aquello", "ello"})
MIN_WORDS = 4

AMBIGUOUS_PENALTY, AMBIGUOUS_MAX = 15, 45
SUGGESTIONS = {
    "ambiguous_term": "Hazlo medible: indica una cifra, un tiempo o un criterio comprobable.",
    "not_measurable": "Un requisito no funcional necesita una cifra que se pueda comprobar.",
    "too_short": "Describe esta parte con más detalle.",
    "missing_verb": "Indica la acción o el resultado con un verbo.",
    "vague_reference": "Nombra aquello a lo que te refieres en lugar de usar un pronombre.",
}


@lru_cache(maxsize=1)
def base_lexicon() -> tuple[str, ...]:
    lines = LEXICON.read_text(encoding="utf-8").splitlines()
    return tuple(
        line.strip().lower() for line in lines if line.strip() and not line.startswith("#")
    )


def _lemma(term: str) -> str:
    return " ".join(token.lemma_.lower() for token in nlp()(term))


def _issue(code: str, field: str, penalty: int, term: str | None = None) -> dict[str, Any]:
    issue: dict[str, Any] = {"code": code, "field": field, "penalty": penalty}
    if term is not None:
        issue["term"] = term
    issue["suggestion"] = SUGGESTIONS[code]
    return issue


def quality(context: Context) -> list[dict[str, Any]]:
    terms = [
        *base_lexicon(),
        *(t.strip().lower() for t in context.job.settings.extraAmbiguousTerms),
    ]
    # Una palabra suelta se busca por su lema (rápida, rápidos…); una expresión, tal cual.
    single = {_lemma(term): term for term in terms if " " not in term and term.isalpha()}
    phrases = [term for term in terms if term not in single.values()]
    patterns = [
        (term, re.compile(rf"(?<![\w]){re.escape(term)}(?![\w])", re.IGNORECASE))
        for term in phrases
    ]

    details = context.data.details
    texts = [getattr(detail, field) for detail in details for field in FIELDS]
    parsed = list(nlp().pipe(texts, batch_size=64))
    result = []
    for index, detail in enumerate(details):
        issues: list[dict[str, Any]] = []
        ambiguous = 0
        for offset, field in enumerate(FIELDS):
            doc = parsed[index * len(FIELDS) + offset]
            text = getattr(detail, field)
            found: list[str] = []
            for token in doc:
                term = single.get(token.lemma_.lower()) or single.get(token.lower_)
                if term and term not in found:
                    found.append(term)
            found.extend(term for term, pattern in patterns if pattern.search(text))
            for term in found:
                penalty = min(AMBIGUOUS_PENALTY, AMBIGUOUS_MAX - ambiguous)
                if penalty <= 0:
                    break
                ambiguous += penalty
                issues.append(_issue("ambiguous_term", field, penalty, term))

            words = [token for token in doc if token.is_alpha]
            has_verb = any(token.pos_ in ("VERB", "AUX") for token in doc)
            if field == "then" and not has_verb:
                issues.append(_issue("missing_verb", field, 15))
            elif field == "when" and not has_verb:
                issues.append(_issue("missing_verb", field, 10))
            if len(words) < MIN_WORDS:
                issues.append(_issue("too_short", field, 10))
            if any(token.lower_ in VAGUE for token in doc):
                issues.append(_issue("vague_reference", field, 5))
            if (
                field == "then"
                and detail.type == "non_functional"
                and not any(token.like_num or token.is_digit for token in doc)
            ):
                issues.append(_issue("not_measurable", field, 15))

        score = max(0, 100 - sum(issue["penalty"] for issue in issues))
        result.append({"detailId": detail.id, "score": score, "issues": issues})
    return result


TECHNIQUES["quality"] = quality
