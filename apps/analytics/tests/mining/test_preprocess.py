"""Preprocesamiento en español (feature 007, T026, FR-004)."""

from analytics.mining.preprocess import analyze, ngrams

from .helpers import context, detail


def test_lematiza_y_quita_palabras_vacias_y_del_dominio() -> None:
    ctx = context(
        [
            detail(
                1,
                given="los usuarios tienen productos en los carritos",
                when="el sistema debe validar los pagos",
                then="se emiten las facturas electrónicas",
            )
        ]
    )
    [doc] = analyze(ctx)
    assert doc.id == "d1"
    assert doc.activity_key == "act-01"
    assert list(doc.lemmas) == [
        "producto",
        "carrito",
        "validar",
        "pago",
        "emitir",
        "factura",
        "electrónico",
    ]


def test_las_palabras_vacias_del_proyecto_tambien_se_quitan() -> None:
    plain = analyze(context([detail(1)]))[0].lemmas
    assert "pasarela" in plain
    custom = analyze(context([detail(1)], extraStopwords=["Pasarela", "carrito"]))[0].lemmas
    assert "pasarela" not in custom and "carrito" not in custom


def test_ignora_urls_numeros_y_signos() -> None:
    ctx = context(
        [detail(1, then="se abre https://tienda.example.com/pedido/42 en menos de 3 segundos")]
    )
    lemmas = analyze(ctx)[0].lemmas
    assert all(lemma.isalpha() for lemma in lemmas)
    assert "https" not in lemmas and "tienda" not in lemmas
    assert "segundo" in lemmas


def test_ngramas_de_uno_a_tres_lemas() -> None:
    assert ngrams(("validar", "pago", "tarjeta")) == [
        "validar",
        "pago",
        "tarjeta",
        "validar pago",
        "pago tarjeta",
        "validar pago tarjeta",
    ]
    assert ngrams(("pago",)) == ["pago"]


def test_se_calcula_una_vez_y_guarda_la_proporcion_de_texto_no_reconocido() -> None:
    ctx = context([detail(1), detail(2)])
    assert analyze(ctx) is analyze(ctx)
    assert ctx.extra["preprocess"]["unrecognizedRatio"] < 0.1

    other = context(
        [detail(1, given="xqzt wplk the qwrtp", when="zzkj blorf mnbv", then="asdfg qwert zxcvb")]
    )
    analyze(other)
    assert other.extra["preprocess"]["unrecognizedRatio"] > 0.5


def test_el_conjunto_de_validacion_completo_se_preprocesa() -> None:
    docs = analyze(context())
    assert len(docs) == 300
    assert all(doc.lemmas for doc in docs)
