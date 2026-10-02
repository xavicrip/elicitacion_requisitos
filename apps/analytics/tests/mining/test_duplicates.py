"""Pares de casi duplicados (feature 007, T037, FR-007)."""

from typing import Any

from analytics.mining.duplicates import duplicates
from analytics.mining.schemas import DuplicatePair

from .helpers import context, detail

ORIGINAL = {
    "given": "el cliente eligió pagar con tarjeta de crédito",
    "when": "confirma el pago del pedido",
    "then": "la pasarela autoriza la transacción en menos de 3 segundos",
}
PARAPHRASE = {
    "given": "el comprador eligió pagar con tarjeta de crédito",
    "when": "aprueba el pago del pedido",
    "then": "la pasarela autoriza la transacción en un tiempo inferior a 3 segundos",
}
OTHER_RESULT = {**ORIGINAL, "then": "se emite la factura electrónica con el valor pagado"}
UNRELATED = {
    "given": "el almacén tiene stock del producto",
    "when": "el operario imprime la etiqueta de envío",
    "then": "el paquete lleva la etiqueta con el código de barras",
}


def pairs(details: list[dict[str, Any]], decisions: list[dict[str, Any]] | None = None) -> Any:
    ctx = context(details)
    if decisions:
        data = ctx.data.model_copy(
            update={
                "duplicateDecisions": type(ctx.data)
                .model_validate(
                    {**ctx.data.model_dump(by_alias=True), "duplicateDecisions": decisions}
                )
                .duplicateDecisions
            }
        )
        ctx.data = data
    return [DuplicatePair.model_validate(pair) for pair in duplicates(ctx)]


def test_una_parafrasis_en_la_misma_actividad_es_un_posible_duplicado() -> None:
    [pair] = pairs([detail(1, **ORIGINAL), detail(2, **PARAPHRASE), detail(3, **UNRELATED)])
    assert pair.pair == ("d1", "d2")
    assert 0.85 <= pair.similarity <= 1


def test_mismo_contexto_y_accion_con_otro_resultado_no_es_duplicado() -> None:
    assert pairs([detail(1, **ORIGINAL), detail(2, **OTHER_RESULT)]) == []


def test_entre_actividades_el_umbral_es_mas_exigente() -> None:
    near = {**PARAPHRASE, "given": "una persona decidió abonar usando su tarjeta bancaria"}
    same = pairs([detail(1, **ORIGINAL), detail(2, **near)])
    across = pairs([detail(1, **ORIGINAL), detail(2, activityKey="otra", **near)])
    assert len(across) <= len(same)
    exact = pairs([detail(1, **ORIGINAL), detail(2, activityKey="otra", **ORIGINAL)])
    assert [pair.pair for pair in exact] == [("d1", "d2")]


def test_un_par_ya_decidido_no_vuelve_a_proponerse() -> None:
    details = [detail(1, **ORIGINAL), detail(2, **PARAPHRASE)]
    for decision in ("rejected", "confirmed"):
        assert pairs(details, [{"pair": ["d2", "d1"], "decision": decision}]) == []


def test_ordena_por_similitud_y_no_repite_pares() -> None:
    found = pairs(
        [
            detail(1, **ORIGINAL),
            detail(2, **PARAPHRASE),
            detail(3, **ORIGINAL),
            detail(4, **UNRELATED),
        ]
    )
    assert found[0].pair == ("d1", "d3")
    assert found[0].similarity >= found[-1].similarity
    assert len({pair.pair for pair in found}) == len(found)


def test_con_un_solo_detalle_no_hay_pares() -> None:
    assert pairs([detail(1)]) == []
