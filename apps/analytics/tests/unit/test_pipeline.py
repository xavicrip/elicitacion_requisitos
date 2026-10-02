"""Pipeline de la detección (feature 006, T022/T029): de la URL firmada al resultado."""

import asyncio
import importlib.util
import json
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from analytics.detection.errors import DetectionError
from analytics.detection.pipeline import DetectionOptions, detect, process
from analytics.detection.schemas import DetectionJobInput, Stage

FIXTURES = Path(__file__).parents[1] / "fixtures"
INPUT = json.loads((Path(__file__).parents[1] / "contract/examples/input.json").read_text())


def _ensure() -> Path:
    spec = importlib.util.spec_from_file_location("generate", FIXTURES / "generate.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate"] = module
    spec.loader.exec_module(module)
    folder: Path = module.ensure()
    return folder


DIAGRAMS = _ensure()
PNG = (DIAGRAMS / "004.png").read_bytes()


@pytest.fixture(scope="module")
def server() -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - nombre de la librería estándar
            routes = {"/004.png": (200, PNG), "/roto.png": (200, b"no es una imagen")}
            status, body = routes.get(self.path, (403, b"AccessDenied"))
            self.send_response(status)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def job(url: str) -> DetectionJobInput:
    return DetectionJobInput.model_validate({**INPUT, "image": {**INPUT["image"], "url": url}})


def test_detect_devuelve_el_contrato_con_zonas_normalizadas_y_progreso() -> None:
    import cv2

    stages: list[tuple[Stage, int]] = []
    result = detect(
        cv2.imread(str(DIAGRAMS / "004.png")),
        DetectionOptions(),
        lambda stage, pct: stages.append((stage, pct)),
    )
    assert [activity.type for activity in result.activities] == ["action"] * 5
    assert [activity.tempId for activity in result.activities] == ["a1", "a2", "a3", "a4", "a5"]
    assert all(activity.label for activity in result.activities)
    assert all(activity.confidence >= 0.8 for activity in result.activities)
    assert result.stats.ocrMeanConfidence is not None and not result.stats.llmUsed
    assert [stage for stage, _ in stages][:2] == ["shapes", "ocr"]
    assert [pct for _, pct in stages] == sorted(pct for _, pct in stages)


def test_una_accion_sin_nombre_legible_lleva_empty_label_y_baja_de_confianza() -> None:
    import numpy as np

    from analytics.detection.pipeline import confidence
    from analytics.detection.shapes import Box, Shape

    shape = Shape("action", Box(0, 0, 10, 10), Box(0, 0, 10, 10), 1.0)
    assert confidence(shape, "", 0.0) == 0.6
    assert confidence(shape, "Validar pago", 0.9) == pytest.approx(0.96)
    assert confidence(Shape("start", shape.box, shape.box, 0.9), "", 0.0) == 0.9
    image = np.full((300, 400, 3), 255, np.uint8)
    assert detect(image, DetectionOptions()).activities == []


@pytest.mark.asyncio
async def test_process_descarga_la_imagen_firmada_y_publica_el_progreso(server: str) -> None:
    progress: list[tuple[Stage, int]] = []

    async def report(stage: Stage, pct: int) -> None:
        progress.append((stage, pct))

    result = await process(job(f"{server}/004.png"), report)
    await asyncio.sleep(0.05)  # el último aviso llega desde el hilo del pipeline
    assert len(result.activities) == 5
    assert progress[0] == ("download", 5)
    assert {stage for stage, _ in progress} >= {"download", "shapes", "ocr"}


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/caducada.png", "/roto.png"])
async def test_una_url_caducada_o_una_imagen_ilegible_falla_con_image_download_failed(
    server: str, path: str
) -> None:
    async def report(stage: Stage, pct: int) -> None:
        pass

    with pytest.raises(DetectionError) as error:
        await process(job(f"{server}{path}"), report)
    assert error.value.code == "IMAGE_DOWNLOAD_FAILED"
