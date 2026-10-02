"""Temas y grupos sobre el conjunto de validación (feature 007, T028, FR-006)."""

from collections import Counter

import pytest

from analytics.mining.clusters import clusters
from analytics.mining.run import Context
from analytics.mining.schemas import Clusters, Topic
from analytics.mining.topics import topics

from .helpers import TRUTH, context


@pytest.fixture(scope="module")
def ctx() -> Context:
    return context()


@pytest.fixture(scope="module")
def found(ctx: Context) -> list[Topic]:
    return [Topic.model_validate(topic) for topic in topics(ctx)]


def test_los_tres_temas_conocidos_salen_como_temas_distintos(found: list[Topic]) -> None:
    majority: dict[str, str] = {}
    pure = total = 0
    for topic in found:
        labels = Counter(TRUTH["topics"][detail_id] for detail_id in topic.detailIds)
        name, count = labels.most_common(1)[0]
        majority[topic.id] = name
        pure += count
        total += len(topic.detailIds)
    assert {"pagos", "notificaciones", "seguridad"} <= set(majority.values())
    # Pureza: detalles cuyo tema real es el mayoritario de su tema encontrado.
    assert pure / total >= 0.8


def test_cada_tema_tiene_terminos_detalles_y_actividades(found: list[Topic]) -> None:
    assert found
    seen: set[str] = set()
    for topic in found:
        assert topic.label and len(topic.terms) <= 10
        assert len(topic.detailIds) >= 5
        assert topic.activityKeys
        assert not seen & set(topic.detailIds)  # un detalle pertenece a un solo tema
        seen |= set(topic.detailIds)
    sizes = [len(topic.detailIds) for topic in found]
    assert sizes == sorted(sizes, reverse=True)
    pagos = next(
        topic
        for topic in found
        if Counter(TRUTH["topics"][d] for d in topic.detailIds).most_common(1)[0][0] == "pagos"
    )
    assert {"pago", "tarjeta", "pasarela", "cobro", "banco"} & {t.term for t in pagos.terms}


def test_los_grupos_tienen_al_menos_tres_detalles_y_hay_un_punto_por_detalle(
    ctx: Context,
) -> None:
    result = Clusters.model_validate(clusters(ctx))
    assert result.groups and result.points
    assert len(result.points) == 300
    assert len({point.detailId for point in result.points}) == 300
    group_ids = {group.id for group in result.groups}
    for group in result.groups:
        assert len(group.detailIds) >= 3
        assert group.representativeId in group.detailIds
    for point in result.points:
        assert point.groupId is None or point.groupId in group_ids


def test_el_resultado_es_reproducible() -> None:
    first, second = topics(context()), topics(context())
    assert first == second
