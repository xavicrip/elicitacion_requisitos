"""Evaluación de la detección sobre el conjunto de validación (feature 006, research R8, T022).

Empareja cada actividad real con la propuesta de mayor IoU (≥ 0,5) y calcula, por subconjunto:

- recall de zonas: actividades reales con una propuesta del mismo tipo;
- exactitud de etiquetas: acciones emparejadas cuyo nombre leído coincide (similitud ≥ 0,9);
- recall de transiciones: flechas reales propuestas entre las zonas emparejadas.

Uso: ``uv run --directory apps/analytics python tests/eval/evaluate_detection.py --subset digital``
(``--timing`` añade el tiempo por diagrama; ``--llm`` activa el refinamiento con Claude).
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import cv2

from analytics.detection.llm_refine import LlmSettings, refine
from analytics.detection.pipeline import DetectionOptions, detect
from analytics.detection.schemas import DetectionResult

FIXTURES = Path(__file__).parents[1] / "fixtures"

ZONE_GATE = 0.85  # SC-001
LABEL_GATE = 0.80  # SC-002
IOU_MATCH = 0.5
LABEL_SIMILARITY = 0.9


def _generator() -> Any:
    spec = importlib.util.spec_from_file_location("generate", FIXTURES / "generate.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate"] = module
    spec.loader.exec_module(module)
    return module


def iou(a: dict[str, float], b: dict[str, float]) -> float:
    x0, y0 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x1 = min(a["x"] + a["w"], b["x"] + b["w"])
    y1 = min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union else 0.0


def normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def similar(a: str, b: str) -> bool:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio() >= LABEL_SIMILARITY


@dataclass
class Score:
    zones: int = 0
    zones_found: int = 0
    labels: int = 0
    labels_ok: int = 0
    transitions: int = 0
    transitions_found: int = 0
    transitions_proposed: int = 0
    proposals: int = 0
    seconds: float = 0.0
    misses: list[str] = field(default_factory=list)

    def add(self, other: Score) -> None:
        for name in (
            "zones",
            "zones_found",
            "labels",
            "labels_ok",
            "transitions",
            "transitions_found",
            "transitions_proposed",
            "proposals",
        ):
            setattr(self, name, getattr(self, name) + getattr(other, name))
        self.seconds += other.seconds
        self.misses += other.misses

    @property
    def zone_recall(self) -> float:
        return self.zones_found / self.zones if self.zones else 1.0

    @property
    def label_accuracy(self) -> float:
        return self.labels_ok / self.labels if self.labels else 1.0

    @property
    def transition_precision(self) -> float:
        if not self.transitions_proposed:
            return 1.0
        return self.transitions_found / self.transitions_proposed

    @property
    def transition_recall(self) -> float:
        return self.transitions_found / self.transitions if self.transitions else 1.0


def score(truth: dict[str, Any], result: DetectionResult, seconds: float) -> Score:
    proposals = [activity.model_dump() for activity in result.activities]
    matched: dict[str, str] = {}  # id real → tempId
    taken: set[str] = set()
    out = Score(proposals=len(proposals), seconds=seconds)
    for activity in truth["activities"]:
        out.zones += 1
        best, best_iou = None, IOU_MATCH
        for proposal in proposals:
            if proposal["tempId"] in taken:
                continue
            overlap = iou(activity["bbox"], proposal["bbox"])
            if overlap >= best_iou:
                best, best_iou = proposal, overlap
        if best and best["type"] == activity["type"]:
            out.zones_found += 1
            taken.add(best["tempId"])
            matched[activity["id"]] = best["tempId"]
        else:
            found = f"{best['type']}" if best else "nada"
            out.misses.append(f"{truth['id']} {activity['id']} {activity['type']} → {found}")
        if activity["type"] == "action":
            out.labels += 1
            if best and similar(best["label"], activity["label"]):
                out.labels_ok += 1
            elif best:
                out.misses.append(
                    f"{truth['id']} {activity['id']} «{activity['label']}» → «{best['label']}»"
                )
    proposed = {(t.source, t.target) for t in result.transitions}
    out.transitions_proposed = len(proposed)
    for transition in truth["transitions"]:
        out.transitions += 1
        source, target = matched.get(transition["from"]), matched.get(transition["to"])
        if source and target and (source, target) in proposed:
            out.transitions_found += 1
    return out


def evaluate(
    subset: str | None, llm: bool = False, ids: list[str] | None = None
) -> dict[str, Score]:
    folder = _generator().ensure()
    totals: dict[str, Score] = {}
    per_diagram: dict[str, Score] = {}
    for path in sorted(folder.glob("*.json")):
        truth = json.loads(path.read_text(encoding="utf-8"))
        if subset and truth["subset"] != subset:
            continue
        if ids and truth["id"] not in ids:
            continue
        image = cv2.imread(str(folder / f"{truth['id']}.png"))
        started = time.perf_counter()
        result = detect(image, DetectionOptions(llm_refine=llm))
        if llm:  # manual y con coste: necesita ANTHROPIC_API_KEY
            result = asyncio.run(refine(image, result, LlmSettings.from_env()))
        result_score = score(truth, result, time.perf_counter() - started)
        per_diagram[truth["id"]] = result_score
        totals.setdefault(truth["subset"], Score()).add(result_score)
    totals.update({f"#{key}": value for key, value in per_diagram.items()})
    return totals


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subset", choices=["digital", "scanned", "photo"])
    parser.add_argument("--timing", action="store_true")
    parser.add_argument("--llm", action="store_true")
    parser.add_argument("--misses", action="store_true")
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args()
    totals = evaluate(args.subset, args.llm, args.ids or None)
    for name, item in totals.items():
        timing = f" · {item.seconds:5.1f} s" if args.timing else ""
        print(
            f"{name:10} zonas {item.zone_recall:5.1%} ({item.zones_found}/{item.zones}) · "
            f"etiquetas {item.label_accuracy:5.1%} ({item.labels_ok}/{item.labels}) · "
            f"transiciones {item.transition_recall:5.1%} (precisión "
            f"{item.transition_precision:5.1%}) · propuestas {item.proposals}{timing}"
        )
        if args.misses and not name.startswith("#"):
            for miss in item.misses:
                print(f"    {miss}")
    digital = totals.get("digital")
    if digital and (digital.zone_recall < ZONE_GATE or digital.label_accuracy < LABEL_GATE):
        print(f"Gate no superado: zonas ≥ {ZONE_GATE:.0%} y etiquetas ≥ {LABEL_GATE:.0%}")
        sys.exit(1)


if __name__ == "__main__":
    main()
