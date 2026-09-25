from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml
from fastapi.testclient import TestClient

from analytics.config import load_settings
from analytics.main import create_app

CONTRACT = Path(__file__).parents[4] / "specs/001-plataforma-base/contracts/health.openapi.yaml"


@pytest.fixture(scope="module")
def health_schema() -> dict[str, Any]:
    contract = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    schema: dict[str, Any] = contract["components"]["schemas"]["Health"]
    return schema


def client_for(env: dict[str, str]) -> TestClient:
    return TestClient(create_app(load_settings(env), check_timeout_s=0.5))


def test_health_cumple_el_contrato(base_env: dict[str, str], health_schema: dict[str, Any]) -> None:
    with client_for(base_env) as client:
        response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    jsonschema.validate(body, health_schema)
    assert body["service"] == "analytics"
    assert body["status"] == "ok"
    assert set(body["checks"]) == {"mongo", "redis"}
    assert response.headers["x-request-id"]


def test_version_cumple_el_contrato(base_env: dict[str, str]) -> None:
    with client_for(base_env) as client:
        body = client.get("/version").json()
    assert body == {"service": "analytics", "version": "0.1.0", "commit": "abc1234"}


def test_503_con_mongo_caido(base_env: dict[str, str], health_schema: dict[str, Any]) -> None:
    with client_for({**base_env, "MONGO_URL": "mongodb://127.0.0.1:1"}) as client:
        response = client.get("/health")
    assert response.status_code == 503
    body = response.json()
    jsonschema.validate(body, health_schema)
    assert body["status"] == "degraded"
    assert body["checks"]["mongo"]["status"] == "down"
    assert body["checks"]["mongo"]["error"]
    assert body["checks"]["redis"]["status"] == "up"


def test_503_con_redis_caido(base_env: dict[str, str]) -> None:
    with client_for({**base_env, "REDIS_URL": "redis://127.0.0.1:1"}) as client:
        response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["checks"]["redis"]["status"] == "down"
