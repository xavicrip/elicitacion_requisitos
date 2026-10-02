"""Contrato v1 de la cola `detection` (specs/006-deteccion-asistida/contracts/detection-job.md).

Espejo pydantic de `packages/shared/src/detection.ts`: los dos validan los mismos ejemplos.
"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

CONTRACT_VERSION = 1
EPSILON = 1e-9

Stage = Literal["download", "shapes", "ocr", "arrows", "refine"]
ActivityType = Literal["action", "decision", "start", "end"]
Flag = Literal["possible_duplicate", "llm_added", "llm_corrected", "empty_label"]
Confidence = Field(ge=0, le=1)
# Los campos en camelCase son los nombres del contrato compartido con `api`.


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BBox(_Model):
    """Caja normalizada (0–1) respecto a la imagen de entrada."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def _inside(self) -> Self:
        if self.x + self.w > 1 + EPSILON or self.y + self.h > 1 + EPSILON:
            raise ValueError("La zona debe quedar dentro de la imagen.")
        return self


class ImageRef(_Model):
    url: HttpUrl
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class DetectionOptions(_Model):
    llmRefine: bool
    arrows: bool
    languages: list[str] = Field(min_length=1)


class DetectionJobInput(_Model):
    v: Literal[1]
    jobId: str = Field(min_length=1)
    versionId: str = Field(min_length=1)
    image: ImageRef
    options: DetectionOptions
    requestId: str = Field(min_length=1)


class DetectionProgress(_Model):
    stage: Stage
    pct: int = Field(ge=0, le=100)


class DetectedActivity(_Model):
    tempId: str = Field(min_length=1)
    bbox: BBox
    type: ActivityType
    label: str = Field(max_length=300)
    confidence: float = Confidence
    flags: list[Flag] = Field(default_factory=list)


class DetectedTransition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    source: str = Field(alias="from", min_length=1)
    target: str = Field(alias="to", min_length=1)
    confidence: float = Confidence


class DetectionStats(_Model):
    durationMs: int = Field(ge=0)
    llmUsed: bool
    ocrMeanConfidence: float | None = Field(ge=0, le=1)


class DetectionResult(_Model):
    v: Literal[1] = 1
    activities: list[DetectedActivity] = Field(max_length=500)
    transitions: list[DetectedTransition] = Field(max_length=2000)
    stats: DetectionStats

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        ids: set[str] = set()
        for activity in self.activities:
            if activity.tempId in ids:
                raise ValueError(f"tempId repetido: {activity.tempId}")
            ids.add(activity.tempId)
        for transition in self.transitions:
            if transition.source not in ids or transition.target not in ids:
                raise ValueError("Transición entre zonas inexistentes")
            if transition.source == transition.target:
                raise ValueError("Transición de una zona a sí misma")
        return self
