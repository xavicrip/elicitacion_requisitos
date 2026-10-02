"""Insights con Claude (feature 007, T048; FR-012, SC-006). Cliente simulado, sin llamadas."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest

from analytics.mining.insights import (
    EvidenceRef,
    InsightDraft,
    InsightDrafts,
    InsightsSettings,
    insights,
    summarize,
    verify,
)
from analytics.mining.run import Context, SkipStage, process
from analytics.mining.schemas import (
    AnalysisInputFile,
    AnalysisJobInput,
    AnalysisResults,
    ProgressStage,
)

TESTS = Path(__file__).parents[1]
VALIDATION = json.loads((TESTS / "fixtures/details/validation.json").read_text("utf-8"))
EXAMPLES = TESTS / "contract/examples/analysis"
JOB = json.loads((EXAMPLES / "job-input.json").read_text("utf-8"))
SETTINGS = InsightsSettings(api_key="sk-test", model="claude-opus-5-5", timeout_s=60)

DETAILS = VALIDATION["input"]["details"]
FIRST = DETAILS[0]["id"]


def context(**settings: Any) -> Context:
    job = {**JOB, "settings": {**JOB["settings"], "rejectedInsights": [], **settings}}
    ctx = Context(
        job=AnalysisJobInput.model_validate(job),
        data=AnalysisInputFile.model_validate(VALIDATION["input"]),
        previous=None,
    )
    ctx.sections.update(
        {
            "topics": [
                {
                    "id": "t0",
                    "label": "pago · tarjeta · pasarela",
                    "terms": [],
                    "detailIds": [d["id"] for d in DETAILS[:60]],
                    "activityKeys": ["act-04"],
                }
            ],
            "association": [
                {
                    "antecedent": ["tag:pagos"],
                    "consequent": ["type:non_functional"],
                    "support": 0.2,
                    "confidence": 0.9,
                    "lift": 2.5,
                    "sentence": "Cuando la etiqueta es pagos, el 90 % son no funcionales.",
                }
            ],
            "quality": [
                {"detailId": FIRST, "score": 70, "issues": [{"code": "ambiguous_term"}]},
                {"detailId": DETAILS[1]["id"], "score": 100, "issues": []},
            ],
            "hotcold": [
                {
                    "activityKey": "act-04",
                    "class": "hot",
                    "score": 1.8,
                    "reason": "muchos requisitos",
                }
            ],
        }
    )
    return ctx


def draft(title: str, statement: str, evidence: list[tuple[str, str]]) -> InsightDraft:
    return InsightDraft(
        title=title,
        statement=statement,
        recommendation="Revisarlo con el equipo.",
        evidence=[EvidenceRef.model_validate({"kind": kind, "id": ref}) for kind, ref in evidence],
    )


GOOD = [
    draft(
        "Pagos concentra lo no funcional",
        "El 90 % de los requisitos de pagos son no funcionales.",
        [("rule", "0")],
    ),
    draft("Un tema domina", "El tema de pagos reúne el 20 % de los detalles.", [("topic", "t0")]),
    draft(
        "Validar pago es crítica",
        "Validar pago concentra muchos requisitos.",
        [("activity", "act-04")],
    ),
    draft(
        "Hay ambigüedad",
        "Un detalle tiene términos ambiguos.",
        [("quality", FIRST), ("detail", FIRST)],
    ),
]


class FakeMessages:
    def __init__(self, *replies: Any) -> None:
        self.replies = list(replies)
        self.calls: list[dict[str, Any]] = []

    def parse(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, BaseException):
            raise reply
        return reply


def client_with(*replies: Any) -> tuple[Any, FakeMessages]:
    messages = FakeMessages(*replies)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def answer(drafts: list[InsightDraft], stop_reason: str = "end_turn") -> Any:
    return SimpleNamespace(stop_reason=stop_reason, parsed_output=InsightDrafts(insights=drafts))


def test_pide_salida_estructurada_y_devuelve_los_insights_con_su_evidencia() -> None:
    client, messages = client_with(answer(GOOD))
    ctx = context()
    result = insights(ctx, SETTINGS, client)
    [call] = messages.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["output_format"] is InsightDrafts
    assert call["fallbacks"] == "default"
    assert call["timeout"] == 60
    assert [item["id"] for item in result] == ["i1", "i2", "i3", "i4"]
    assert result[0] == {
        "id": "i1",
        "title": "Pagos concentra lo no funcional",
        "statement": "El 90 % de los requisitos de pagos son no funcionales.",
        "recommendation": "Revisarlo con el equipo.",
        "evidence": [{"kind": "rule", "id": "0"}],
    }
    assert ctx.extra["insightsFewerThanExpected"] is False
    # Lo devuelto cumple el contrato de resultados.
    AnalysisResults.model_validate({"schemaVersion": 1, "stages": {}, "insights": result})


def test_el_resumen_enviado_no_lleva_datos_personales_y_si_identificadores() -> None:
    client, messages = client_with(answer(GOOD))
    insights(context(), SETTINGS, client)
    prompt = messages.calls[0]["messages"][0]["content"]
    assert "@" not in prompt
    assert "authorRole" not in prompt and "Cajero" not in prompt
    for identifier in ('"t0"', '"act-04"', "total_details", "type:non_functional", FIRST):
        assert identifier in prompt
    assert "en español" in prompt


def test_los_rechazados_del_proyecto_van_en_las_instrucciones() -> None:
    client, messages = client_with(answer(GOOD))
    insights(
        context(rejectedInsights=["La mayoría de requisitos son funcionales"]), SETTINGS, client
    )
    prompt = messages.calls[0]["messages"][0]["content"]
    assert "evita repetirlos" in prompt
    assert "- La mayoría de requisitos son funcionales" in prompt


def test_descarta_evidencias_inexistentes_y_cifras_que_no_cuadran() -> None:
    _, valid, figures = summarize(context())
    kept, dropped = verify(
        [
            *GOOD,
            draft("Evidencia inventada", "Algo sobre un tema.", [("topic", "t99")]),
            draft("Tipo de evidencia equivocado", "Algo.", [("rule", "t0")]),
            draft("Sin evidencia", "Algo sin respaldo.", []),
            draft(
                "Cifra inventada",
                "El 47 % de los requisitos son urgentes.",
                [("kpi", "total_details")],
            ),
            draft("Cifra dentro del margen", "Cerca del 91,5 % en pagos.", [("rule", "0")]),
        ],
        valid,
        figures,
    )
    assert [item.title for item in kept] == [*(g.title for g in GOOD), "Cifra dentro del margen"]
    assert dropped == [
        "Evidencia inventada",
        "Tipo de evidencia equivocado",
        "Sin evidencia",
        "Cifra inventada",
    ]


def test_como_maximo_diez() -> None:
    many = [
        draft(f"Hallazgo {i}", "Validar pago concentra requisitos.", [("activity", "act-04")])
        for i in range(14)
    ]
    client, _ = client_with(answer(many))
    assert len(insights(context(), SETTINGS, client)) == 10


def test_con_menos_de_tres_validos_reintenta_una_vez_con_los_descartados() -> None:
    bad = draft("Cifra inventada", "El 47 % son urgentes.", [("kpi", "total_details")])
    client, messages = client_with(answer([GOOD[0], bad]), answer(GOOD))
    ctx = context()
    result = insights(ctx, SETTINGS, client)
    assert len(messages.calls) == 2
    assert "- Cifra inventada" in messages.calls[1]["messages"][0]["content"]
    assert len(result) == 4
    assert ctx.extra["insightsFewerThanExpected"] is False


def test_si_tras_reintentar_siguen_faltando_devuelve_los_que_haya_y_lo_marca() -> None:
    client, messages = client_with(answer([GOOD[0]]), answer([GOOD[0], GOOD[1]]))
    ctx = context()
    result = insights(ctx, SETTINGS, client)
    assert len(messages.calls) == 2
    assert [item["title"] for item in result] == [GOOD[0].title, GOOD[1].title]
    assert ctx.extra["insightsFewerThanExpected"] is True


def test_sin_clave_la_etapa_se_omite_sin_llamar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    client, messages = client_with(answer(GOOD))
    with pytest.raises(SkipStage) as skipped:
        insights(context(), None, client)
    assert skipped.value.reason == "NO_API_KEY"
    assert messages.calls == []


@pytest.mark.parametrize(
    "reply",
    [
        answer(GOOD, stop_reason="refusal"),
        anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com")),
        RuntimeError("fallo inesperado"),
    ],
)
def test_una_negativa_un_timeout_o_un_error_hacen_fallar_solo_esta_etapa(reply: Any) -> None:
    client, _ = client_with(reply)
    with pytest.raises(Exception):  # noqa: B017, PT011 - cualquier fallo del proveedor
        insights(context(), SETTINGS, client)


@pytest.mark.asyncio
async def test_en_el_analisis_el_resto_de_resultados_queda_intacto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def progress(stage: ProgressStage, pct: int) -> None:
        return None

    job = AnalysisJobInput.model_validate({**JOB, "stages": ["hotcold", "insights"]})
    data = AnalysisInputFile.model_validate(VALIDATION["input"])
    heat = [{"activityKey": "act-04", "class": "hot", "score": 2.0, "reason": "muchos requisitos"}]

    def failing(ctx: Context) -> Any:
        client, _ = client_with(RuntimeError("proveedor caído"))
        return insights(ctx, SETTINGS, client)

    failed = await process(
        job, data, None, progress, {"hotcold": lambda ctx: heat, "insights": failing}
    )
    assert failed.results.stages["insights"].status == "failed"
    assert failed.results.hotcold is not None and failed.results.insights is None
    assert failed.partial is True

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    skipped = await process(
        job, data, None, progress, {"hotcold": lambda ctx: heat, "insights": insights}
    )
    stage = skipped.results.stages["insights"]
    assert (stage.status, stage.reason) == ("skipped", "NO_API_KEY")
    assert skipped.partial is False

    # Solo hay actividades y KPIs como evidencia (las demás secciones no se calcularon).
    drafts = [
        draft(f"Hallazgo {i}", "Validar pago concentra requisitos.", [("activity", "act-04")])
        for i in range(3)
    ]

    def working(ctx: Context) -> Any:
        client, _ = client_with(answer(drafts))
        return insights(ctx, SETTINGS, client)

    done = await process(
        job, data, None, progress, {"hotcold": lambda ctx: heat, "insights": working}
    )
    assert done.results.insights is not None and len(done.results.insights) == 3
    assert done.results.insightsFewerThanExpected is False


def test_settings_desde_el_entorno(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert InsightsSettings.from_env() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    monkeypatch.delenv("INSIGHTS_LLM_MODEL", raising=False)
    settings = InsightsSettings.from_env()
    assert settings is not None and settings.model == "claude-opus-5-5"
    monkeypatch.setenv("INSIGHTS_LLM_MODEL", "claude-sonnet-5-5")
    again = InsightsSettings.from_env()
    assert again is not None and again.model == "claude-sonnet-5-5"
