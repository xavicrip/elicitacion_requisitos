"""Contrato v1 de la cola `export` (specs/008-exportacion-resultados/contracts/export-job.md).

Espejo pydantic de `packages/shared/src/exports.ts`: los dos validan los mismos ejemplos
(`tests/contract/examples/export/`). Reutiliza los filtros, los detalles y los resultados del
análisis del contrato de la 007.
"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from analytics.mining.schemas import AnalysisResults, Filters, InputDetail, Stages

CONTRACT_VERSION = 1
INPUT_VERSION = 1
# Los campos en camelCase son los nombres del contrato compartido con `api`.


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ExportJobInput(_Model):
    v: Literal[1]
    exportId: str = Field(min_length=1)
    projectId: str = Field(min_length=1)
    inputUrl: HttpUrl
    outputUrl: HttpUrl
    requestId: str = Field(min_length=1)


class Project(_Model):
    name: str
    timezone: str = Field(min_length=1)


class Kpis(_Model):
    totalDetails: int = Field(ge=0)
    activeParticipants: int = Field(ge=0)
    coveredActivitiesPct: float = Field(ge=0, le=100)
    validatedPct: float = Field(ge=0, le=100)


class Count(_Model):
    key: str
    label: str
    count: int


class TimelineDay(_Model):
    date: str
    created: int = Field(ge=0)
    votes: int = Field(ge=0)
    comments: int = Field(ge=0)


class Descriptive(_Model):
    """El `DescriptiveDashboard` de la 007, calculado por `api` con los mismos filtros (SC-004)."""

    kpis: Kpis
    byActivity: list[Count]
    byType: list[Count]
    byPriority: list[Count]
    byRole: list[Count]
    byStatus: list[Count]
    timeline: list[TimelineDay]


class BBox(_Model):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class DiagramImage(_Model):
    url: HttpUrl
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class DiagramActivity(_Model):
    key: str = Field(min_length=1)
    label: str
    bbox: BBox
    detailCount: int = Field(ge=0)


class Diagram(_Model):
    id: str = Field(min_length=1)
    name: str
    image: DiagramImage
    activities: list[DiagramActivity]


class Analysis(_Model):
    """El último análisis terminado, tal como lo muestra el dashboard."""

    finishedAt: str
    stages: Stages
    results: AnalysisResults


class ExportInputFile(_Model):
    """`input.json.gz`: sin nombres ni identificadores de personas (sí el rol declarado)."""

    schemaVersion: Literal[1]
    project: Project
    generatedAt: str
    filters: Filters
    descriptive: Descriptive
    diagrams: list[Diagram]
    details: list[InputDetail]
    analysis: Analysis | None


class ExportError(_Model):
    code: str = Field(min_length=1)
    message: str


class ExportJobReturn(_Model):
    v: Literal[1] = 1
    status: Literal["done", "failed"]
    bytes: int | None = Field(default=None, gt=0)
    pages: int | None = Field(default=None, gt=0)
    error: ExportError | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.status == "failed" and self.error is None:
            raise ValueError("Una exportación fallida indica el código de error")
        if self.status == "done" and (self.bytes is None or self.pages is None):
            raise ValueError("Una exportación terminada indica el tamaño y las páginas")
        return self
