"""Palabras clave, nube y coocurrencia (feature 007, T027, FR-005)."""

from collections import Counter

from analytics.mining.cooccurrence import cooccurrence
from analytics.mining.keywords import class_tfidf, keywords
from analytics.mining.schemas import Cooccurrence, Keywords

from .helpers import context, detail


def test_ctfidf_premia_lo_distintivo_de_cada_clase() -> None:
    ranked = class_tfidf(
        {
            "pagos": Counter({"pago": 6, "tarjeta": 4, "pedido": 4}),
            "envios": Counter({"envío": 6, "repartidor": 4, "pedido": 4}),
        }
    )
    assert [term for term, _ in ranked["pagos"]][:2] == ["pago", "tarjeta"]
    assert ranked["pagos"][-1][0] == "pedido"  # común a las dos: el menos distintivo
    assert [term for term, _ in ranked["envios"]][0] == "envío"


def test_cada_actividad_recibe_sus_terminos_distintivos() -> None:
    result = Keywords.model_validate(keywords(context()))
    assert result.byActivity is not None and result.wordCloud is not None
    terms = {entry.activityKey: [term.term for term in entry.terms] for entry in result.byActivity}
    # act-04 es "Validar pago" (pagos) y act-03 "Iniciar sesión" (seguridad).
    assert {"pago", "tarjeta"} & set(terms["act-04"])
    assert {"contraseña", "sesión", "cuenta"} & set(terms["act-03"])
    assert not {"contraseña", "sesión"} & set(terms["act-04"][:5])
    assert "act-10" not in terms  # la actividad sin detalles no aparece
    for entry in result.byActivity:
        weights = [term.weight for term in entry.terms]
        assert len(weights) <= 15 and weights == sorted(weights, reverse=True)


def test_la_nube_usa_la_frecuencia_global_de_los_lemas() -> None:
    result = Keywords.model_validate(keywords(context()))
    assert result.wordCloud is not None
    cloud = result.wordCloud
    assert len(cloud) <= 100
    assert [term.weight for term in cloud] == sorted((t.weight for t in cloud), reverse=True)
    assert all(" " not in term.term for term in cloud)
    assert cloud[0].weight >= 30


def test_con_muy_pocos_detalles_tambien_funciona() -> None:
    result = Keywords.model_validate(keywords(context([detail(1), detail(2, activityKey="b")])))
    assert result.byActivity is not None
    assert [entry.activityKey for entry in result.byActivity] == ["act-01", "b"]


def test_la_red_conserva_pares_frecuentes_con_pmi_positivo() -> None:
    result = Cooccurrence.model_validate(cooccurrence(context()))
    assert result.nodes is not None and result.edges is not None
    assert 0 < len(result.edges) <= 150
    assert all(edge.count >= 3 and edge.pmi > 0 for edge in result.edges)
    ids = {node.id for node in result.nodes}
    assert all(edge.source in ids and edge.target in ids for edge in result.edges)
    assert len({node.community for node in result.nodes}) >= 2
    assert "pago" in ids


def test_sin_pares_repetidos_la_red_queda_vacia() -> None:
    result = cooccurrence(context([detail(1)]))
    assert result == {"nodes": [], "edges": []}
