"""Gates de la minería sobre el conjunto de validación (feature 007, T038; SC-003 y SC-004)."""

from analytics.mining.duplicates import duplicates
from analytics.mining.quality import quality

from .helpers import TRUTH, context


def test_duplicados_recall_y_falsos_positivos() -> None:
    """SC-003: al menos el 80 % de los pares preparados, con menos del 20 % de falsos positivos."""
    expected = {tuple(sorted(pair)) for pair in TRUTH["duplicatePairs"]}
    found = {tuple(pair["pair"]) for pair in duplicates(context())}
    recall = len(found & expected) / len(expected)
    false_positives = len(found - expected) / len(found) if found else 0
    print(f"duplicados: recall {recall:.0%} · falsos positivos {false_positives:.0%}")
    assert recall >= 0.80
    assert false_positives < 0.20


def test_terminos_ambiguos_recall() -> None:
    """SC-004: se señala al menos el 80 % de los términos ambiguos preparados."""
    results = {result["detailId"]: result for result in quality(context())}
    flagged = total = 0
    for detail_id, terms in TRUTH["ambiguous"].items():
        found = {
            issue.get("term")
            for issue in results[detail_id]["issues"]
            if issue["code"] == "ambiguous_term"
        }
        total += len(terms)
        flagged += sum(1 for term in terms if term in found)
    recall = flagged / total
    print(f"ambiguos: recall {recall:.0%} ({flagged}/{total})")
    assert recall >= 0.80


def test_los_detalles_sin_terminos_ambiguos_casi_nunca_se_marcan() -> None:
    results = quality(context())
    clean = [result for result in results if result["detailId"] not in TRUTH["ambiguous"]]
    wrongly = [
        result
        for result in clean
        if any(issue["code"] == "ambiguous_term" for issue in result["issues"])
    ]
    assert len(wrongly) / len(clean) < 0.05
