"""Refinamiento opcional de la detección con Claude (research R5, plan ajuste 11).

Con el flag `detection-llm` y `ANTHROPIC_API_KEY`, se envían la imagen del diagrama y las zonas
detectadas y se piden, con salida estructurada, correcciones de nombre y tipo y las zonas
omitidas. Solo la imagen sale del sistema, nunca datos de usuarios. Si el modelo se niega, falla
o tarda más de 30 s, se sigue con el resultado local: la detección nunca depende del modelo.
"""

import asyncio
import base64
import json
import logging
import os
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

import anthropic
import cv2
import numpy as np
from pydantic import BaseModel, Field

from analytics.detection.preprocess import Image8
from analytics.detection.schemas import (
    ActivityType,
    BBox,
    DetectedActivity,
    DetectionResult,
    Flag,
)

logger = logging.getLogger("analytics.detection.llm")

DEFAULT_MODEL = "claude-opus-5-5"
# Lado mayor de la imagen enviada: suficiente para leer los nombres, con menos tokens.
MAX_SIDE = 1600
# Una corrección solo vale para la misma zona (research R5).
SAME_ZONE_IOU = 0.7
# Por debajo, el nombre corregido no se parece al leído: probablemente traducido o inventado.
MIN_SIMILARITY = 0.5
ADDED_CONFIDENCE = 0.6


@dataclass(frozen=True)
class LlmSettings:
    api_key: str
    model: str
    timeout_s: float = 30

    @classmethod
    def from_env(cls) -> "LlmSettings | None":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return None
        return cls(api_key=api_key, model=os.environ.get("DETECTION_LLM_MODEL") or DEFAULT_MODEL)


class ZoneCorrection(BaseModel):
    tempId: str = Field(description="El tempId de la zona que se corrige")  # noqa: N815
    label: str = Field(description="Nombre tal como aparece en la imagen, sin traducir")
    type: ActivityType
    bbox: BBox


class NewZone(BaseModel):
    label: str
    type: ActivityType
    bbox: BBox


class Corrections(BaseModel):
    corrections: list[ZoneCorrection]
    added: list[NewZone]


PROMPT = """Este es un diagrama de actividades UML y las zonas que ha detectado un sistema de \
visión, con su caja normalizada (0–1 respecto a la imagen), su tipo y el texto leído por OCR:

{zones}

Revisa cada zona con la imagen:
- Corrige el nombre si el OCR lo leyó mal y el tipo si no es el correcto (action: acción, \
decision: rombo, start: círculo relleno, end: círculo con anillo).
- Incluye en `corrections` solo las zonas que cambian, con su tempId y su caja.
- Añade en `added` las actividades que se vean en la imagen y falten en la lista.
- No traduzcas: escribe los nombres exactamente en el idioma en que aparecen en la imagen.
- No inventes zonas que no se vean."""


def _iou(a: BBox, b: BBox) -> float:
    x0, y0 = max(a.x, b.x), max(a.y, b.y)
    x1, y1 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union else 0.0


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.casefold(), b.casefold()).ratio()


def _png(image: Image8) -> str:
    h, w = image.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    if scale < 1.0:
        image = np.asarray(
            cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA),
            dtype=np.uint8,
        )
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("No se pudo codificar la imagen")
    return base64.standard_b64encode(encoded.tobytes()).decode("ascii")


def _zones(result: DetectionResult) -> str:
    return json.dumps(
        [
            {
                "tempId": activity.tempId,
                "type": activity.type,
                "label": activity.label,
                "bbox": activity.bbox.model_dump(),
            }
            for activity in result.activities
        ],
        ensure_ascii=False,
    )


def apply(result: DetectionResult, corrections: Corrections) -> DetectionResult:
    """Aplica las correcciones válidas y añade las zonas omitidas."""
    by_id = {correction.tempId: correction for correction in corrections.corrections}
    activities: list[DetectedActivity] = []
    for activity in result.activities:
        correction = by_id.get(activity.tempId)
        label = correction.label.strip() if correction else ""
        valid = (
            correction is not None
            and label != ""
            and _iou(activity.bbox, correction.bbox) >= SAME_ZONE_IOU
            and (not activity.label or _similar(activity.label, label) >= MIN_SIMILARITY)
        )
        if not valid or correction is None:
            activities.append(activity)
            continue
        flags: list[Flag] = [flag for flag in activity.flags if flag != "empty_label"]
        if "llm_corrected" not in flags:
            flags.append("llm_corrected")
        activities.append(
            activity.model_copy(
                update={
                    "label": label,
                    "type": correction.type,
                    "flags": flags,
                    "confidence": max(activity.confidence, 0.7),
                }
            )
        )
    next_id = len(result.activities) + 1
    for zone in corrections.added:
        if not zone.label.strip() and zone.type == "action":
            continue
        activities.append(
            DetectedActivity(
                tempId=f"a{next_id}",
                bbox=zone.bbox,
                type=zone.type,
                label=zone.label.strip(),
                confidence=ADDED_CONFIDENCE,
                flags=["llm_added"],
            )
        )
        next_id += 1
    return result.model_copy(
        update={
            "activities": activities,
            "stats": result.stats.model_copy(update={"llmUsed": True}),
        }
    )


async def refine(
    image: Image8,
    result: DetectionResult,
    settings: LlmSettings | None,
    client: Any = None,
) -> DetectionResult:
    """Resultado refinado, o el local si no hay clave o el modelo falla, se niega o tarda."""
    if settings is None or not settings.api_key:
        return result
    api = client or anthropic.AsyncAnthropic(api_key=settings.api_key, max_retries=1)
    try:
        response = await asyncio.wait_for(
            api.beta.messages.parse(
                model=settings.model,
                max_tokens=16000,
                # Una negativa por política se reintenta en otro modelo en la misma llamada.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_format=Corrections,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": _png(image),
                                },
                            },
                            {"type": "text", "text": PROMPT.format(zones=_zones(result))},
                        ],
                    }
                ],
                timeout=settings.timeout_s,
            ),
            timeout=settings.timeout_s,
        )
    except TimeoutError:
        logger.warning("refinamiento sin respuesta a tiempo")
        return result
    except anthropic.APIError as error:
        logger.warning("refinamiento fallido", extra={"error": type(error).__name__})
        return result
    except Exception as error:  # noqa: BLE001 - el refinamiento nunca hace fallar la detección
        logger.warning("refinamiento fallido", extra={"error": type(error).__name__})
        return result
    if response.stop_reason == "refusal" or response.parsed_output is None:
        logger.warning("refinamiento rechazado", extra={"stop_reason": response.stop_reason})
        return result
    return apply(result, response.parsed_output)
