"""Reglas de asociación entre etiquetas, tipos, prioridades y actividades (research R8, FR-010).

Cada detalle es una transacción con los ítems `tag:*`, `type:*`, `priority:*` y `activity:*`.
Apriori encuentra los conjuntos frecuentes y se conservan las reglas con confianza y *lift*
suficientes, cada una con una frase que la explica.
"""

from typing import Any

from analytics.mining.run import TECHNIQUES, Context

MIN_SUPPORT = 0.05
MIN_CONFIDENCE = 0.6
MIN_LIFT = 1.2
#: Una regla necesita al menos tres detalles que la cumplan.
MIN_COUNT = 3
MAX_RULES = 30

TYPE_PHRASE = {
    "functional": "funcionales",
    "non_functional": "no funcionales",
    "business_rule": "reglas de negocio",
    "constraint": "restricciones",
}
PRIORITY_PHRASE = {"must": "Must", "should": "Should", "could": "Could", "wont": "Won't"}


def _describe(item: str, activities: dict[str, str]) -> tuple[str, str]:
    """(condición, consecuencia) en lenguaje natural para un ítem."""
    kind, _, value = item.partition(":")
    if kind == "tag":
        return f"la etiqueta es {value}", f"llevan la etiqueta {value}"
    if kind == "type":
        name = TYPE_PHRASE.get(value, value)
        return f"el requisito es de tipo {name}", f"son {name}"
    if kind == "priority":
        name = PRIORITY_PHRASE.get(value, value)
        return f"la prioridad es {name}", f"tienen prioridad {name}"
    name = activities.get(value, value)
    return f"la actividad es {name}", f"pertenecen a la actividad {name}"


def sentence(
    antecedent: list[str], consequent: list[str], confidence: float, activities: dict[str, str]
) -> str:
    conditions = " y ".join(_describe(item, activities)[0] for item in antecedent)
    outcomes = " y ".join(_describe(item, activities)[1] for item in consequent)
    return f"Cuando {conditions}, el {round(confidence * 100)} % de los requisitos {outcomes}."


def association(context: Context) -> list[dict[str, Any]]:
    import pandas as pd
    from mlxtend.frequent_patterns import apriori, association_rules

    activities = {activity.key: activity.label for activity in context.data.activities}
    transactions = [
        [
            *(f"tag:{tag}" for tag in detail.tags),
            f"type:{detail.type}",
            *([f"priority:{detail.priority}"] if detail.priority else []),
            f"activity:{detail.activityKey}",
        ]
        for detail in context.data.details
    ]
    items = sorted({item for transaction in transactions for item in transaction})
    frame = pd.DataFrame(
        [[item in set(transaction) for item in items] for transaction in transactions],
        columns=items,
    )
    frequent = apriori(frame, min_support=MIN_SUPPORT, use_colnames=True, max_len=3)
    if frequent.empty:
        return []
    rules = association_rules(frequent, metric="confidence", min_threshold=MIN_CONFIDENCE)
    rules = rules[rules["lift"] > MIN_LIFT]

    found: list[tuple[float, float, float, list[str], list[str]]] = []
    for row in rules.itertuples():
        support = float(row.support)
        if support * len(transactions) < MIN_COUNT:
            continue
        found.append(
            (
                float(row.lift),
                float(row.confidence),
                support,
                sorted(row.antecedents),
                sorted(row.consequents),
            )
        )
    # Una regla con una condición de más que no mejora a la más simple es redundante.
    simple = {
        (tuple(antecedent), tuple(consequent)): confidence
        for _, confidence, _, antecedent, consequent in found
    }
    kept = []
    for lift, confidence, support, antecedent, consequent in found:
        redundant = any(
            set(other) < set(antecedent) and consequent == list(same) and best >= confidence - 0.05
            for (other, same), best in simple.items()
        )
        if not redundant:
            kept.append((lift, confidence, support, antecedent, consequent))
    kept.sort(key=lambda rule: (-rule[0], -rule[1], rule[3], rule[4]))
    return [
        {
            "antecedent": antecedent,
            "consequent": consequent,
            "support": round(support, 3),
            "confidence": round(confidence, 3),
            "lift": round(lift, 3),
            "sentence": sentence(antecedent, consequent, confidence, activities),
        }
        for lift, confidence, support, antecedent, consequent in kept[:MAX_RULES]
    ]


TECHNIQUES["association"] = association
