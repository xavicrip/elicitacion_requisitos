"""Refinamiento opcional con Claude (feature 006, T044). Cliente simulado: sin llamadas reales."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import numpy as np
import pytest

from analytics.detection.llm_refine import (
    Corrections,
    LlmSettings,
    NewZone,
    ZoneCorrection,
    refine,
)
from analytics.detection.schemas import BBox, DetectionResult

RESULT = DetectionResult.model_validate(
    json.loads((Path(__file__).parents[1] / "contract/examples/result.json").read_text())
)
IMAGE = np.full((400, 600, 3), 255, np.uint8)
SETTINGS = LlmSettings(api_key="sk-test", model="claude-opus-5-5", timeout_s=30)


class FakeMessages:
    def __init__(self, reply: Any) -> None:
        self.reply = reply
        self.calls: list[dict[str, Any]] = []

    async def parse(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if isinstance(self.reply, BaseException):
            raise self.reply
        if callable(self.reply):
            return await self.reply()
        return self.reply


def client_with(reply: Any) -> tuple[Any, FakeMessages]:
    messages = FakeMessages(reply)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def answer(corrections: Corrections, stop_reason: str = "end_turn") -> Any:
    return SimpleNamespace(stop_reason=stop_reason, parsed_output=corrections)


def box(activity_index: int) -> BBox:
    return RESULT.activities[activity_index].bbox


async def run(client: Any, settings: LlmSettings | None = SETTINGS) -> DetectionResult:
    return await refine(IMAGE, RESULT, settings, client=client)


@pytest.mark.asyncio
async def test_envia_solo_la_imagen_y_las_zonas_y_pide_salida_estructurada() -> None:
    client, messages = client_with(answer(Corrections(corrections=[], added=[])))
    await run(client)
    [call] = messages.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["output_format"] is Corrections
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    content = call["messages"][0]["content"]
    assert [block["type"] for block in content] == ["image", "text"]
    assert content[0]["source"]["media_type"] == "image/png"
    text = content[1]["text"]
    assert "Validar pago" in text and "a1" in text
    # Ningún dato de usuarios: solo la imagen y las zonas detectadas.
    assert "@" not in text


@pytest.mark.asyncio
async def test_una_correccion_sobre_la_misma_zona_sustituye_nombre_y_tipo() -> None:
    corrections = Corrections(
        corrections=[
            ZoneCorrection(tempId="a2", label="Emitir facturas", type="action", bbox=box(1)),
        ],
        added=[],
    )
    client, _ = client_with(answer(corrections))
    result = await run(client)
    emitir = next(a for a in result.activities if a.tempId == "a2")
    assert emitir.label == "Emitir facturas"
    assert "llm_corrected" in emitir.flags
    assert result.stats.llmUsed is True


@pytest.mark.asyncio
async def test_una_correccion_de_otra_zona_se_ignora() -> None:
    elsewhere = BBox(x=0.6, y=0.6, w=0.2, h=0.1)
    corrections = Corrections(
        corrections=[
            ZoneCorrection(tempId="a2", label="Otra cosa", type="decision", bbox=elsewhere)
        ],
        added=[],
    )
    client, _ = client_with(answer(corrections))
    emitir = next(a for a in (await run(client)).activities if a.tempId == "a2")
    assert emitir.label == "Emitir factura" and emitir.type == "action"


@pytest.mark.asyncio
async def test_conserva_el_idioma_una_correccion_traducida_se_descarta() -> None:
    corrections = Corrections(
        corrections=[
            ZoneCorrection(tempId="a2", label="Issue invoice", type="action", bbox=box(1))
        ],
        added=[],
    )
    client, messages = client_with(answer(corrections))
    emitir = next(a for a in (await run(client)).activities if a.tempId == "a2")
    assert emitir.label == "Emitir factura"
    assert "No traduzcas" in messages.calls[0]["messages"][0]["content"][1]["text"]


@pytest.mark.asyncio
async def test_las_zonas_omitidas_entran_con_confianza_media_y_llm_added() -> None:
    corrections = Corrections(
        corrections=[],
        added=[
            NewZone(label="Enviar pedido", type="action", bbox=BBox(x=0.12, y=0.6, w=0.15, h=0.06))
        ],
    )
    client, _ = client_with(answer(corrections))
    result = await run(client)
    added = result.activities[-1]
    assert added.tempId == "a4"
    assert added.label == "Enviar pedido"
    assert added.flags == ["llm_added"]
    assert 0.5 <= added.confidence < 0.8


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply",
    [
        answer(Corrections(corrections=[], added=[]), stop_reason="refusal"),
        anthropic.APITimeoutError(request=httpx2.Request("POST", "https://api.anthropic.com")),
        RuntimeError("fallo inesperado"),
    ],
)
async def test_una_negativa_un_error_o_un_timeout_devuelven_el_resultado_local(reply: Any) -> None:
    client, _ = client_with(reply)
    assert await run(client) == RESULT


@pytest.mark.asyncio
async def test_mas_de_30_segundos_devuelve_el_resultado_local() -> None:
    async def slow() -> Any:
        await asyncio.sleep(5)
        return answer(Corrections(corrections=[], added=[]))

    client, _ = client_with(slow)
    result = await refine(
        IMAGE, RESULT, LlmSettings(api_key="sk-test", model="m", timeout_s=0.2), client=client
    )
    assert result == RESULT


@pytest.mark.asyncio
async def test_sin_clave_no_se_llama() -> None:
    client, messages = client_with(answer(Corrections(corrections=[], added=[])))
    assert await run(client, settings=None) == RESULT
    assert await run(client, settings=LlmSettings(api_key="", model="m", timeout_s=30)) == RESULT
    assert messages.calls == []


def test_settings_desde_el_entorno(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert LlmSettings.from_env() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    monkeypatch.delenv("DETECTION_LLM_MODEL", raising=False)
    settings = LlmSettings.from_env()
    assert settings is not None and settings.model == "claude-opus-5-5"
    monkeypatch.setenv("DETECTION_LLM_MODEL", "claude-sonnet-5-5")
    assert LlmSettings.from_env().model == "claude-sonnet-5-5"  # type: ignore[union-attr]
