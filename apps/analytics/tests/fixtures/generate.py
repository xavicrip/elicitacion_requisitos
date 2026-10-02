"""Conjunto de validación de la detección (feature 006, research R8, T004).

Genera 30 diagramas de actividades con su *ground truth*: 20 digitales en tres estilos
(PlantUML, draw.io y StarUML), 5 "escaneados" (ruido, desenfoque y una leve rotación) y 5
"fotos" (perspectiva, sombra y bajo contraste). Es reproducible: con la misma semilla produce
los mismos píxeles. Solo se versionan los JSON: los PNG (≈ 30 MB, el ruido comprime mal) se
generan al vuelo con ``ensure()`` cuando faltan, y una prueba comprueba que la generación
reproduce los JSON versionados.

Uso: ``uv run --directory apps/analytics python tests/fixtures/generate.py``
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
OUT = HERE / "diagrams"
FONTS = HERE / "fonts"

NodeType = Literal["action", "decision", "start", "end"]
Subset = Literal["digital", "scanned", "photo"]
Color = tuple[int, int, int]
Image8 = NDArray[np.uint8]


@dataclass(frozen=True)
class Style:
    fill: Color
    stroke: Color
    text: Color
    arrow: Color
    font: str
    radius: float  # radio de las esquinas respecto a la altura de la acción
    stroke_width: int
    background: Color = (255, 255, 255)


STYLES: dict[str, Style] = {
    "plantuml": Style(
        (254, 254, 206), (168, 0, 54), (0, 0, 0), (168, 0, 54), "DejaVuSans.ttf", 0.35, 2
    ),
    "drawio": Style((255, 255, 255), (0, 0, 0), (0, 0, 0), (0, 0, 0), "DejaVuSans.ttf", 0.18, 2),
    "staruml": Style(
        (228, 238, 252),
        (52, 92, 160),
        (20, 30, 60),
        (52, 92, 160),
        "DejaVuSerif.ttf",
        0.28,
        3,
        (250, 250, 250),
    ),
}

ACTIONS = [
    "Registrar pedido",
    "Validar pago",
    "Emitir factura",
    "Revisar solicitud",
    "Aprobar crédito",
    "Notificar al cliente",
    "Calcular envío",
    "Preparar paquete",
    "Confirmar dirección",
    "Asignar transportista",
    "Actualizar inventario",
    "Generar orden de compra",
    "Verificar identidad",
    "Enviar cotización",
    "Registrar devolución",
    "Evaluar riesgo",
    "Firmar contrato",
    "Archivar expediente",
    "Programar reunión",
    "Solicitar documentos",
    "Analizar requisitos",
    "Diseñar solución",
    "Estimar esfuerzo",
    "Planificar sprint",
    "Ejecutar pruebas",
    "Corregir defectos",
    "Desplegar versión",
    "Capacitar usuarios",
    "Recibir mercadería",
    "Inspeccionar calidad",
    "Clasificar reclamo",
    "Responder consulta",
    "Escalar incidente",
    "Cerrar ticket",
    "Medir satisfacción",
    "Publicar resultados",
    "Revisar presupuesto",
    "Autorizar gasto",
    "Pagar proveedor",
    "Conciliar cuentas",
    "Elaborar informe",
    "Validar información",
    "Crear usuario",
    "Asignar permisos",
    "Bloquear acceso",
    "Restablecer contraseña",
    "Consultar historial",
    "Imprimir comprobante",
    "Agendar entrega",
    "Coordinar logística",
    "Despachar pedido",
    "Confirmar recepción",
    "Evaluar proveedor",
    "Negociar condiciones",
    "Aprobar diseño",
    "Registrar asistencia",
]


@dataclass
class Node:
    id: str
    type: NodeType
    label: str
    x: int = 0  # esquina superior izquierda (px)
    y: int = 0
    w: int = 0
    h: int = 0

    @property
    def cx(self) -> int:
        return self.x + self.w // 2

    @property
    def cy(self) -> int:
        return self.y + self.h // 2


@dataclass
class Spec:
    id: str
    subset: Subset
    style: str
    actions: int  # acciones del camino principal
    decisions: int = 0
    start_end: bool = True
    seed: int = 0
    rows: int = 8  # nodos por columna
    notes: list[str] = field(default_factory=list)


# 20 digitales, 5 escaneados y 5 fotos. 001 tiene 15 actividades (quickstart §1); 004 es un
# flujo lineal de 5 actividades (US3, 4 transiciones); 020 tiene 50 (SC-003).
SPECS: list[Spec] = [
    Spec("001", "digital", "plantuml", 9, 2, seed=1),
    Spec("002", "digital", "drawio", 6, 1, seed=2),
    Spec("003", "digital", "staruml", 8, 1, seed=3),
    Spec("004", "digital", "drawio", 5, 0, start_end=False, seed=4),
    Spec("005", "digital", "plantuml", 5, 0, seed=5),
    Spec("006", "digital", "drawio", 12, 2, seed=6),
    Spec("007", "digital", "staruml", 14, 2, seed=7),
    Spec("008", "digital", "plantuml", 18, 3, seed=8),
    Spec("009", "digital", "drawio", 9, 1, seed=9),
    Spec("010", "digital", "staruml", 20, 3, seed=10),
    Spec("011", "digital", "plantuml", 7, 1, seed=11),
    Spec("012", "digital", "drawio", 22, 4, seed=12, rows=9),
    Spec("013", "digital", "staruml", 10, 2, seed=13),
    Spec("014", "digital", "plantuml", 25, 4, seed=14, rows=9),
    Spec("015", "digital", "drawio", 15, 2, seed=15),
    Spec("016", "digital", "staruml", 28, 5, seed=16, rows=10),
    Spec("017", "digital", "plantuml", 32, 5, seed=17, rows=10),
    Spec("018", "digital", "drawio", 36, 6, seed=18, rows=10),
    Spec("019", "digital", "staruml", 36, 6, seed=19, rows=11),
    Spec("020", "digital", "plantuml", 38, 6, seed=20, rows=12),
    Spec("021", "scanned", "plantuml", 10, 2, seed=21),
    Spec("022", "scanned", "drawio", 14, 2, seed=22),
    Spec("023", "scanned", "staruml", 8, 1, seed=23),
    Spec("024", "scanned", "drawio", 20, 3, seed=24),
    Spec("025", "scanned", "plantuml", 12, 2, seed=25),
    Spec("026", "photo", "drawio", 8, 1, seed=26),
    Spec("027", "photo", "plantuml", 10, 2, seed=27),
    Spec("028", "photo", "staruml", 6, 1, seed=28),
    Spec("029", "photo", "drawio", 12, 2, seed=29),
    Spec("030", "photo", "plantuml", 9, 1, seed=30),
]

ACTION_W = 260
ACTION_H = 72
DECISION = 76
START = 38
END = 44
ROW_H = 132
SIDE_GAP = 70
COLUMN_GAP = 130
MARGIN = 70
ARROW = 12


def _font(style: Style, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / style.font), size)


def _wrap(label: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    if font.getlength(label) <= max_width:
        return [label]
    words = label.split()
    best = [label]
    best_width = float("inf")
    for i in range(1, len(words)):
        lines = [" ".join(words[:i]), " ".join(words[i:])]
        width = max(font.getlength(line) for line in lines)
        if width < best_width:
            best, best_width = lines, width
    return best


def _build(spec: Spec, rng: np.random.Generator) -> tuple[list[Node], list[tuple[str, str]]]:
    """Nodos y transiciones del flujo: inicio, acciones con decisiones intercaladas y fin."""
    labels = list(rng.permutation(ACTIONS))
    main: list[Node] = []
    side: dict[str, Node] = {}
    counter = 0

    def new(type_: NodeType, label: str) -> Node:
        nonlocal counter
        counter += 1
        return Node(f"a{counter}", type_, label)

    if spec.start_end:
        main.append(new("start", ""))
    decision_slots = (
        set(rng.choice(np.arange(1, spec.actions), size=spec.decisions, replace=False).tolist())
        if spec.decisions
        else set()
    )
    for i in range(spec.actions):
        main.append(new("action", labels.pop()))
        # Nunca en la última fila de una columna: su flecha al cambio de columna cruzaría la rama.
        last_row = len(main) % spec.rows == spec.rows - 1
        if i in decision_slots and i < spec.actions - 1 and not last_row:
            decision = new("decision", "")
            main.append(decision)
            side[decision.id] = new("action", labels.pop())
    if spec.start_end:
        main.append(new("end", ""))

    transitions: list[tuple[str, str]] = []
    for current, following in zip(main, main[1:], strict=False):
        transitions.append((current.id, following.id))
        if current.id in side:
            branch = side[current.id]
            transitions.append((current.id, branch.id))
            transitions.append((branch.id, following.id))
    nodes = main + list(side.values())
    _layout(spec, main, side)
    return nodes, transitions


def _layout(spec: Spec, main: list[Node], side: dict[str, Node]) -> None:
    """Columnas de arriba abajo; las ramas de las decisiones, a la derecha de la decisión."""
    action_w = ACTION_W
    side_w = 240
    column_w = action_w + SIDE_GAP + side_w + COLUMN_GAP
    for index, node in enumerate(main):
        column, row = divmod(index, spec.rows)
        cx = MARGIN + column * column_w + action_w // 2
        cy = MARGIN + row * ROW_H + ROW_H // 2
        size = {
            "action": (action_w, ACTION_H),
            "decision": (DECISION, DECISION),
            "start": (START, START),
            "end": (END, END),
        }[node.type]
        node.w, node.h = size
        node.x, node.y = cx - node.w // 2, cy - node.h // 2
        if node.id in side:
            branch = side[node.id]
            branch.w, branch.h = side_w, ACTION_H
            branch.x = MARGIN + column * column_w + action_w + SIDE_GAP
            branch.y = cy + ROW_H // 2 - ACTION_H // 2


def _arrow_head(
    draw: ImageDraw.ImageDraw, tip: tuple[int, int], direction: str, color: Color
) -> None:
    x, y = tip
    points = {
        "down": [(x, y), (x - ARROW // 2, y - ARROW), (x + ARROW // 2, y - ARROW)],
        "left": [(x, y), (x + ARROW, y - ARROW // 2), (x + ARROW, y + ARROW // 2)],
        "right": [(x, y), (x - ARROW, y - ARROW // 2), (x - ARROW, y + ARROW // 2)],
    }[direction]
    draw.polygon(points, fill=color)


def _route(source: Node, target: Node, branch: bool) -> tuple[list[tuple[int, int]], str]:
    """Polilínea ortogonal de `source` a `target` y la dirección de la punta."""
    if branch and target.x > source.x + source.w:  # decisión → rama a la derecha
        start = (source.x + source.w, source.cy)
        return [start, (target.cx, source.cy), (target.cx, target.y)], "down"
    if source.x > target.x + target.w:  # rama → siguiente del camino principal
        start = (source.cx, source.y + source.h)
        return [start, (source.cx, target.cy), (target.x + target.w, target.cy)], "left"
    if target.y > source.y:  # misma columna
        return [(source.cx, source.y + source.h), (target.cx, target.y)], "down"
    # Cambio de columna: baja, va al hueco entre columnas, sube y entra por arriba.
    gap_x = target.cx - ACTION_W // 2 - COLUMN_GAP // 2
    bottom = source.y + source.h + 24
    top = target.y - 30
    return [
        (source.cx, source.y + source.h),
        (source.cx, bottom),
        (gap_x, bottom),
        (gap_x, top),
        (target.cx, top),
        (target.cx, target.y),
    ], "down"


def _render(spec: Spec, nodes: list[Node], transitions: list[tuple[str, str]]) -> Image8:
    style = STYLES[spec.style]
    width = max(node.x + node.w for node in nodes) + MARGIN
    height = max(node.y + node.h for node in nodes) + MARGIN
    image = Image.new("RGB", (width, height), style.background)
    draw = ImageDraw.Draw(image)
    by_id = {node.id: node for node in nodes}
    branches = {target for source, target in transitions if by_id[source].type == "decision"}

    for source_id, target_id in transitions:
        source, target = by_id[source_id], by_id[target_id]
        points, direction = _route(
            source, target, target_id in branches and source.type == "decision"
        )
        draw.line(points, fill=style.arrow, width=2, joint="curve")
        _arrow_head(draw, points[-1], direction, style.arrow)

    font = _font(style, 21)
    for node in nodes:
        box = (node.x, node.y, node.x + node.w, node.y + node.h)
        if node.type == "action":
            draw.rounded_rectangle(
                box,
                radius=int(node.h * style.radius),
                fill=style.fill,
                outline=style.stroke,
                width=style.stroke_width,
            )
            lines = _wrap(node.label, font, node.w - 28)
            line_h = 26
            top = node.cy - line_h * len(lines) // 2
            for i, line in enumerate(lines):
                draw.text(
                    (node.cx, top + i * line_h + line_h // 2),
                    line,
                    font=font,
                    fill=style.text,
                    anchor="mm",
                )
        elif node.type == "decision":
            draw.polygon(
                [
                    (node.cx, node.y),
                    (node.x + node.w, node.cy),
                    (node.cx, node.y + node.h),
                    (node.x, node.cy),
                ],
                fill=style.fill,
                outline=style.stroke,
                width=style.stroke_width,
            )
        elif node.type == "start":
            draw.ellipse(box, fill=style.stroke)
        else:
            draw.ellipse(box, fill=style.background, outline=style.stroke, width=3)
            inset = 10
            draw.ellipse(
                (node.x + inset, node.y + inset, node.x + node.w - inset, node.y + node.h - inset),
                fill=style.stroke,
            )
    return np.asarray(image, dtype=np.uint8)[:, :, ::-1].copy()  # RGB → BGR (OpenCV)


Corners = NDArray[np.float64]


def _corners(node: Node) -> Corners:
    return np.array(
        [
            [node.x, node.y],
            [node.x + node.w, node.y],
            [node.x + node.w, node.y + node.h],
            [node.x, node.y + node.h],
        ],
        dtype=np.float64,
    )


def _scanned(image: Image8, rng: np.random.Generator) -> tuple[Image8, NDArray[np.float64]]:
    """Rotación leve, desenfoque, ruido y papel algo amarillento."""
    h, w = image.shape[:2]
    angle = float(rng.uniform(-2.0, 2.0))
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    out = cv2.warpAffine(image, matrix, (w, h), borderValue=(245, 245, 240))
    out = cv2.GaussianBlur(out, (3, 3), 0.8)
    noise = rng.normal(0, 9, out.shape)
    tint = np.array([-12, -4, 0], dtype=np.float64)
    out = np.clip(out.astype(np.float64) + noise + tint, 0, 255).astype(np.uint8)
    full = np.vstack([matrix, [0, 0, 1]])
    return out, full


def _photo(image: Image8, rng: np.random.Generator) -> tuple[Image8, NDArray[np.float64]]:
    """Perspectiva, sombra lateral, bajo contraste y ruido de sensor."""
    h, w = image.shape[:2]
    jitter = 0.05
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    dst = src + rng.uniform(-jitter, jitter, (4, 2)).astype(np.float32) * np.array(
        [w, h], dtype=np.float32
    )
    dst = np.clip(dst, [[0, 0]], [[w, h]]).astype(np.float32)
    matrix = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(image, matrix, (w, h), borderValue=(200, 200, 195))
    shadow = np.linspace(0.62, 1.0, w)[None, :, None]
    if rng.random() < 0.5:
        shadow = shadow[:, ::-1]
    low = out.astype(np.float64) * 0.75 + 40
    out = np.clip(low * shadow + rng.normal(0, 6, out.shape), 0, 255).astype(np.uint8)
    out = cv2.GaussianBlur(out, (3, 3), 0.6)
    return out, matrix.astype(np.float64)


def generate(spec: Spec) -> tuple[Image8, dict[str, Any]]:
    """Imagen (BGR) y *ground truth* de un diagrama del conjunto."""
    rng = np.random.default_rng(spec.seed)
    nodes, transitions = _build(spec, rng)
    image = _render(spec, nodes, transitions)
    corners = {node.id: _corners(node) for node in nodes}
    if spec.subset != "digital":
        image, matrix = (_scanned if spec.subset == "scanned" else _photo)(image, rng)
        for node_id, points in corners.items():
            homogeneous = np.hstack([points, np.ones((4, 1))]) @ matrix.T
            corners[node_id] = homogeneous[:, :2] / homogeneous[:, 2:3]
    h, w = image.shape[:2]
    activities = []
    for node in nodes:
        points = corners[node.id]
        x0, y0 = points.min(axis=0)
        x1, y1 = points.max(axis=0)
        activities.append(
            {
                "id": node.id,
                "type": node.type,
                "label": node.label,
                "bbox": {
                    "x": round(max(0.0, x0) / w, 5),
                    "y": round(max(0.0, y0) / h, 5),
                    "w": round((min(float(w), x1) - max(0.0, x0)) / w, 5),
                    "h": round((min(float(h), y1) - max(0.0, y0)) / h, 5),
                },
            }
        )
    truth = {
        "id": spec.id,
        "subset": spec.subset,
        "style": spec.style,
        "width": w,
        "height": h,
        "activities": activities,
        "transitions": [{"from": source, "to": target} for source, target in transitions],
    }
    return image, truth


def _write(spec: Spec, image: Image8, truth: dict[str, Any]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT / f"{spec.id}.png"), image, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    (OUT / f"{spec.id}.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n")


def ensure() -> Path:
    """Genera los PNG que falten (no se versionan) y devuelve la carpeta del conjunto."""
    for spec in SPECS:
        if not (OUT / f"{spec.id}.png").exists():
            image, truth = generate(spec)
            _write(spec, image, truth)
    return OUT


def main() -> None:
    for spec in SPECS:
        image, truth = generate(spec)
        _write(spec, image, truth)
        print(f"{spec.id} {spec.subset:8} {spec.style:8} {len(truth['activities']):3} nodos")


if __name__ == "__main__":
    main()
