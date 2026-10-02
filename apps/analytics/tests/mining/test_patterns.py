"""Sentimiento, reglas de asociación y actividades críticas (feature 007, T044; FR-008–FR-011)."""

import os
from typing import Any

import pytest

from analytics.mining.association import association, sentence
from analytics.mining.hotcold import hotcold
from analytics.mining.schemas import ActivityHeat, AssociationRule, Sentiment
from analytics.mining.sentiment import Label, default_classifier, sentiment

from .helpers import TRUTH, context, detail


def fake_classifier(negative: set[str], positive: set[str] | None = None) -> Any:
    """Clasificador simulado: negativo si el texto contiene alguna de las palabras dadas."""

    def classify(texts: list[str]) -> list[dict[Label, float]]:
        scores: list[dict[Label, float]] = []
        for text in texts:
            if any(word in text for word in negative):
                scores.append({"NEG": 0.9, "NEU": 0.08, "POS": 0.02})
            elif any(word in text for word in positive or set()):
                scores.append({"NEG": 0.02, "NEU": 0.18, "POS": 0.8})
            else:
                scores.append({"NEG": 0.3, "NEU": 0.65, "POS": 0.05})
        return scores

    return classify


def test_sentimiento_por_actividad_y_solo_destaca_lo_claramente_negativo() -> None:
    ctx = context(
        [
            detail(1, given="es frustrante que el pago falle"),
            detail(2, given="el pago funciona genial"),
            detail(3),
            detail(4, activityKey="act-02", given="odio que el envío tarde"),
            detail(5, activityKey="act-02"),
        ]
    )
    result = Sentiment.model_validate(
        sentiment(ctx, fake_classifier({"frustrante", "odio"}, {"genial"}))
    )
    assert result.byActivity is not None and result.mostNegative is not None
    assert [(a.activityKey, a.pos, a.neu, a.neg) for a in result.byActivity] == [
        ("act-01", 1, 1, 1),
        ("act-02", 0, 1, 1),
    ]
    # Un 0,3 de negatividad no se destaca: los requisitos suelen ser neutros.
    assert [n.detailId for n in result.mostNegative] == ["d1", "d4"]
    assert ctx.shared["negative_details"] == ["d1", "d4"]


def test_como_maximo_los_10_mas_negativos() -> None:
    ctx = context([detail(index, given=f"odio el paso {index}") for index in range(14)])
    result = sentiment(ctx, fake_classifier({"odio"}))
    assert len(result["mostNegative"]) == 10


@pytest.mark.skipif(os.environ.get("CI") != "true", reason="descarga el modelo: solo en el CI")
def test_el_modelo_real_distingue_el_malestar_de_un_requisito_neutro() -> None:
    scores = default_classifier()(
        [
            "es inaceptable y muy molesto que el pago falle siempre, lo odio",
            "el cliente confirma el pago del pedido y la pasarela lo autoriza",
        ]
    )
    assert scores[0]["NEG"] > 0.7
    assert scores[1]["NEG"] < 0.5


def test_las_reglas_incluyen_la_preparada_con_soporte_confianza_y_frase() -> None:
    rules = [AssociationRule.model_validate(rule) for rule in association(context())]
    assert 0 < len(rules) <= 30
    lifts = [rule.lift for rule in rules]
    assert lifts == sorted(lifts, reverse=True)
    for rule in rules:
        assert rule.support >= 0.05 and rule.confidence >= 0.6 and rule.lift > 1.2
        assert rule.sentence.startswith("Cuando ") and rule.sentence.endswith(".")
    expected = TRUTH["rules"][0]
    prepared = next(
        rule
        for rule in rules
        if rule.antecedent == [expected["antecedent"]]
        and rule.consequent == [expected["consequent"]]
    )
    assert abs(prepared.confidence - expected["confidence"]) < 0.02
    assert prepared.sentence == (
        f"Cuando la etiqueta es pagos, el {round(prepared.confidence * 100)} % de los requisitos "
        "son no funcionales."
    )


def test_la_frase_nombra_la_actividad_y_la_prioridad() -> None:
    text = sentence(
        ["activity:act-04", "priority:must"],
        ["type:functional"],
        0.714,
        {"act-04": "Validar pago"},
    )
    assert text == (
        "Cuando la actividad es Validar pago y la prioridad es Must, "
        "el 71 % de los requisitos son funcionales."
    )


def test_con_pocos_datos_o_sin_patrones_no_hay_reglas() -> None:
    assert association(context([detail(1), detail(2, type="constraint")])) is not None
    # Doce detalles sin nada en común dos a dos: ningún patrón llega a tres detalles.
    kinds = ["functional", "constraint", "business_rule", "non_functional"]
    varied = [
        detail(index, type=kinds[index % 4], tags=[], priority=None, activityKey=f"a{index % 6}")
        for index in range(12)
    ]
    assert association(context(varied)) == []


def test_las_actividades_preparadas_salen_calientes_y_frias_con_su_motivo() -> None:
    heat = {
        entry["activityKey"]: ActivityHeat.model_validate(entry) for entry in hotcold(context())
    }
    assert len(heat) == 10
    for key in TRUTH["hot"]:
        assert heat[key].class_ == "hot", key
        assert heat[key].reason in {
            "muchos requisitos",
            "muchos votos",
            "mucha discusión en los comentarios",
            "requisitos descartados o con malestar expresado",
        }
    without, few = heat["act-10"], heat["act-09"]
    assert (without.class_, without.reason) == ("cold", "sin requisitos todavía")
    assert (few.class_, few.reason) == ("cold", "muy pocos requisitos")
    assert {key for key, entry in heat.items() if entry.class_ == "hot"} == set(TRUTH["hot"])
    assert {key for key, entry in heat.items() if entry.class_ == "cold"} == set(TRUTH["cold"])


def test_el_malestar_expresado_cuenta_como_desacuerdo() -> None:
    details = [detail(index, activityKey=f"a{index % 4}") for index in range(40)]
    ctx = context(details)
    ctx.data = ctx.data.model_copy(
        update={
            "activities": [
                type(ctx.data.activities[0]).model_validate(
                    {"key": f"a{index}", "diagramId": "d", "label": f"Actividad {index}"}
                )
                for index in range(4)
            ]
        }
    )
    calm = {entry["activityKey"]: entry["score"] for entry in hotcold(ctx)}
    ctx.shared["negative_details"] = [d["id"] for d in details if d["activityKey"] == "a0"]
    upset = {entry["activityKey"]: entry["score"] for entry in hotcold(ctx)}
    assert upset["a0"] > calm["a0"]


def test_sin_actividades_no_hay_clasificacion() -> None:
    ctx = context([detail(1)])
    ctx.data = ctx.data.model_copy(update={"activities": []})
    assert hotcold(ctx) == []
