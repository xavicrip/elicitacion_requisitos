"""Contrato v1 de la cola `analysis` (specs/007-dashboard-analitico/contracts/analysis-job.md).

Espejo pydantic de `packages/shared/src/analytics.ts`: los dos validan los mismos ejemplos. No
depende del grupo `mining`, así que `test-python` lo importa sin los modelos.
"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

CONTRACT_VERSION = 1
RESULTS_VERSION = 1

Stage = Literal[
    "keywords",
    "cooccurrence",
    "topics",
    "clusters",
    "duplicates",
    "sentiment",
    "quality",
    "association",
    "hotcold",
    "insights",
]
STAGES: tuple[Stage, ...] = (
    "keywords",
    "cooccurrence",
    "topics",
    "clusters",
    "duplicates",
    "sentiment",
    "quality",
    "association",
    "hotcold",
    "insights",
)
ProgressStage = Stage | Literal["download", "upload"]
StageStatus = Literal["done", "failed", "skipped"]
DetailType = Literal["functional", "non_functional", "business_rule", "constraint"]
DetailStatus = Literal["pending", "validated", "duplicate", "discarded"]
Priority = Literal["must", "should", "could", "wont"]
# Los campos en camelCase son los nombres del contrato compartido con `api`.


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class StageResult(_Model):
    status: StageStatus
    durationMs: int | None = Field(default=None, ge=0)
    reason: str | None = None
    error: str | None = None


Stages = dict[Stage, StageResult]
Term = str


class JobSettings(_Model):
    extraAmbiguousTerms: list[Term] = Field(max_length=100)
    extraStopwords: list[Term] = Field(max_length=200)
    insightsEnabled: bool
    rejectedInsights: list[str] = Field(max_length=50)


class AnalysisJobInput(_Model):
    v: Literal[1]
    runId: str = Field(min_length=1)
    projectId: str = Field(min_length=1)
    kind: Literal["full", "insights"]
    inputUrl: HttpUrl
    resultsUrl: HttpUrl
    previousResultsUrl: HttpUrl | None
    stages: list[Stage] = Field(min_length=1)
    settings: JobSettings
    requestId: str | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if len(set(self.stages)) != len(self.stages):
            raise ValueError("Etapas repetidas")
        if self.kind == "insights" and (
            self.previousResultsUrl is None or self.stages != ["insights"]
        ):
            raise ValueError("Regenerar insights exige solo esa etapa y los resultados anteriores")
        return self


class AnalysisProgress(_Model):
    stage: ProgressStage
    pct: int = Field(ge=0, le=100)


class Filters(_Model):
    diagramIds: list[str] | None
    from_: str | None = Field(alias="from")
    to: str | None
    types: list[DetailType] | None
    statuses: list[DetailStatus] = Field(min_length=1)


class InputActivity(_Model):
    key: str = Field(min_length=1)
    diagramId: str = Field(min_length=1)
    label: str


class InputDetail(_Model):
    """Detalle exportado por `api`: nunca lleva el autor (solo su rol declarado)."""

    id: str = Field(min_length=1)
    diagramId: str = Field(min_length=1)
    activityKey: str = Field(min_length=1)
    given: str
    when: str
    then: str
    type: DetailType
    priority: Priority | None
    authorRole: str | None
    tags: list[str]
    status: DetailStatus
    voteCount: int = Field(ge=0)
    commentCount: int = Field(ge=0)
    createdAt: str


class DuplicateDecision(_Model):
    pair: tuple[str, str]
    decision: Literal["confirmed", "rejected"]


class AnalysisInputFile(_Model):
    v: Literal[1]
    projectId: str = Field(min_length=1)
    filters: Filters
    activities: list[InputActivity]
    details: list[InputDetail]
    duplicateDecisions: list[DuplicateDecision]


class ErrorCode(_Model):
    code: str = Field(min_length=1)


class AnalysisJobReturn(_Model):
    v: Literal[1] = 1
    status: Literal["done", "failed"]
    partial: bool
    detailCount: int = Field(ge=0)
    stages: Stages
    error: ErrorCode | None = None

    @model_validator(mode="after")
    def _error_when_failed(self) -> Self:
        if self.status == "failed" and self.error is None:
            raise ValueError("Un análisis fallido indica el código de error")
        return self


# Resultados (`analysis-results.schema.json`, `schemaVersion: 1`): cada sección es opcional.


class WeightedTerm(_Model):
    term: str
    weight: float


class ActivityKeywords(_Model):
    activityKey: str
    terms: list[WeightedTerm]


class Keywords(_Model):
    byActivity: list[ActivityKeywords] | None = None
    wordCloud: list[WeightedTerm] | None = None


class CooccurrenceNode(_Model):
    id: str
    freq: int
    community: int


class CooccurrenceEdge(_Model):
    source: str
    target: str
    pmi: float
    count: int


class Cooccurrence(_Model):
    nodes: list[CooccurrenceNode] | None = None
    edges: list[CooccurrenceEdge] | None = None


class Topic(_Model):
    id: str
    label: str
    terms: list[WeightedTerm]
    detailIds: list[str]
    activityKeys: list[str]


class ClusterGroup(_Model):
    id: str
    detailIds: list[str]
    representativeId: str


class ClusterPoint(_Model):
    detailId: str
    x: float
    y: float
    groupId: str | None


class Clusters(_Model):
    groups: list[ClusterGroup] | None = None
    points: list[ClusterPoint] | None = None


class DuplicatePair(_Model):
    pair: tuple[str, str]
    similarity: float = Field(ge=0, le=1)


class ActivitySentiment(_Model):
    activityKey: str
    pos: int
    neu: int
    neg: int


class NegativeDetail(_Model):
    detailId: str
    score: float


class Sentiment(_Model):
    byActivity: list[ActivitySentiment] | None = None
    mostNegative: list[NegativeDetail] | None = None


class QualityIssue(_Model):
    code: Literal[
        "ambiguous_term", "not_measurable", "too_short", "missing_verb", "vague_reference"
    ]
    field: Literal["given", "when", "then"] | None = None
    term: str | None = None
    penalty: int | None = None
    suggestion: str | None = None


class DetailQuality(_Model):
    detailId: str
    score: int = Field(ge=0, le=100)
    issues: list[QualityIssue]


class AssociationRule(_Model):
    antecedent: list[str]
    consequent: list[str]
    support: float
    confidence: float
    lift: float
    sentence: str


class ActivityHeat(_Model):
    activityKey: str
    class_: Literal["hot", "cold", "normal"] = Field(alias="class")
    score: float
    reason: str


class Evidence(_Model):
    kind: Literal["detail", "activity", "topic", "rule", "quality", "kpi"]
    id: str = Field(min_length=1)


class Insight(_Model):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    recommendation: str | None = None
    evidence: list[Evidence] = Field(min_length=1)


class Preprocess(_Model):
    unrecognizedRatio: float | None = Field(default=None, ge=0, le=1)


class AnalysisResults(_Model):
    schemaVersion: Literal[1]
    stages: Stages
    preprocess: Preprocess | None = None
    keywords: Keywords | None = None
    cooccurrence: Cooccurrence | None = None
    topics: list[Topic] | None = None
    clusters: Clusters | None = None
    duplicates: list[DuplicatePair] | None = None
    sentiment: Sentiment | None = None
    quality: list[DetailQuality] | None = None
    association: list[AssociationRule] | None = None
    hotcold: list[ActivityHeat] | None = None
    insightsFewerThanExpected: bool | None = None
    insights: list[Insight] | None = Field(default=None, max_length=10)
