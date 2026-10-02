"""Calidad del requisito con reglas explicables (feature 007, T036, FR-009)."""

from typing import Any

from analytics.mining.quality import base_lexicon, quality
from analytics.mining.schemas import DetailQuality

from .helpers import context, detail

GOOD = {
    "given": "el cliente tiene productos en el carrito",
    "when": "confirma el pago con su tarjeta",
    "then": "la pasarela autoriza la transacción en menos de 3 segundos",
}


def assess(extra: list[str] | None = None, **fields: Any) -> DetailQuality:
    ctx = context([detail(1, **{**GOOD, **fields})], extraAmbiguousTerms=extra or [])
    [result] = quality(ctx)
    return DetailQuality.model_validate(result)


def codes(result: DetailQuality) -> list[str]:
    return [issue.code for issue in result.issues]


def test_un_requisito_bien_escrito_tiene_100() -> None:
    result = assess(type="non_functional")
    assert result.score == 100
    assert result.issues == []


def test_un_termino_ambiguo_resta_15_y_sugiere_hacerlo_medible() -> None:
    result = assess(then="el sistema debe responder rápido")
    [issue] = result.issues
    assert (issue.code, issue.field, issue.term, issue.penalty) == (
        "ambiguous_term",
        "then",
        "rápido",
        15,
    )
    assert (
        issue.suggestion == "Hazlo medible: indica una cifra, un tiempo o un criterio comprobable."
    )
    assert result.score == 85


def test_reconoce_las_formas_flexionadas_y_las_expresiones() -> None:
    assert assess(then="la respuesta del sistema es rápida").issues[0].term == "rápido"
    assert assess(then="las pantallas son fáciles de usar").issues[0].term == "fácil"
    assert (
        assess(then="se muestran el nombre, el precio, etc. del producto").issues[0].term == "etc."
    )
    assert assess(when="paga con tarjeta y/o con efectivo").issues[0].term == "y/o"
    assert assess(then="el pedido se entrega lo antes posible").issues[0].term == "lo antes posible"


def test_los_terminos_ambiguos_restan_como_maximo_45() -> None:
    result = assess(
        then="la pantalla es rápida, fácil, amigable, intuitiva y eficiente para el cliente"
    )
    ambiguous = [issue for issue in result.issues if issue.code == "ambiguous_term"]
    assert sum(issue.penalty or 0 for issue in ambiguous) == 45
    assert result.score == 55


def test_los_terminos_del_proyecto_tambien_cuentan() -> None:
    assert assess(then="la interfaz es bonita para el cliente").score == 100
    result = assess(["bonito"], then="la interfaz es bonita para el cliente")
    assert result.issues[0].term == "bonito"


def test_un_no_funcional_sin_cifra_no_es_medible() -> None:
    result = assess(type="non_functional", then="la pasarela autoriza la transacción enseguida")
    assert "not_measurable" in codes(result)
    assert (
        assess(type="functional", then="la pasarela autoriza la transacción enseguida").score == 100
    )


def test_componentes_cortos_sin_verbo_o_con_pronombres_vagos() -> None:
    short = assess(when="paga ya")
    assert ("too_short", "when") in [(issue.code, issue.field) for issue in short.issues]
    no_verb = assess(then="confirmación del pago en la pantalla principal")
    assert ("missing_verb", "then", 15) in [(i.code, i.field, i.penalty) for i in no_verb.issues]
    no_action = assess(when="el pago del pedido con la tarjeta")
    assert ("missing_verb", "when", 10) in [(i.code, i.field, i.penalty) for i in no_action.issues]
    vague = assess(then="el sistema guarda eso en el historial del cliente")
    assert "vague_reference" in codes(vague)


def test_el_puntaje_nunca_baja_de_cero_y_cada_problema_trae_su_explicacion() -> None:
    result = assess(
        type="non_functional",
        given="eso",
        when="rápido y fácil",
        then="amigable, intuitivo, eficiente, etc.",
    )
    assert 0 <= result.score < 40
    assert all(issue.suggestion for issue in result.issues)


def test_el_lexico_base_incluye_los_terminos_de_la_spec() -> None:
    assert {"rápido", "fácil", "amigable", "etc."} <= set(base_lexicon())
