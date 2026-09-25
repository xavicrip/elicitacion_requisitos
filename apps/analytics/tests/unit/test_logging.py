import io
import json
import logging
import re

from fastapi import FastAPI
from fastapi.testclient import TestClient

from analytics.logging import RequestIdMiddleware, configure_logging

UUID_V7 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


def make_client() -> tuple[TestClient, io.StringIO]:
    stream = io.StringIO()
    configure_logging("INFO", stream=stream)
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/ping")
    def ping() -> dict[str, str]:
        logging.getLogger("analytics.test").info("dentro del handler")
        return {"ok": "sí"}

    return TestClient(app), stream


def lines(stream: io.StringIO) -> list[dict[str, object]]:
    """Líneas emitidas por el servicio (excluye los logs de httpx del cliente de prueba)."""
    records = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    return [r for r in records if str(r.get("logger", "")).startswith("analytics")]


def test_reutiliza_la_cabecera_entrante_y_la_incluye_en_cada_linea() -> None:
    client, stream = make_client()
    response = client.get("/ping", headers={"x-request-id": "prueba-456"})
    assert response.headers["x-request-id"] == "prueba-456"
    records = lines(stream)
    assert records, "se esperaban líneas de log"
    assert all(record["request_id"] == "prueba-456" for record in records)
    assert any(record["message"] == "dentro del handler" for record in records)


def test_genera_uuid_v7_si_falta_o_es_invalida() -> None:
    client, _ = make_client()
    assert UUID_V7.match(client.get("/ping").headers["x-request-id"])
    invalid = client.get("/ping", headers={"x-request-id": "con espacios " + "x" * 80})
    assert UUID_V7.match(invalid.headers["x-request-id"])


def test_logs_en_json_con_nivel_y_servicio() -> None:
    client, stream = make_client()
    client.get("/ping")
    record = lines(stream)[-1]
    assert record["level"] == "INFO"
    assert record["service"] == "analytics"
    assert record["status"] == 200
    assert "duration_ms" in record
