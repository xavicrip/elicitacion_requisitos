import os
import uuid

import pytest

MONGO_TEST_URL = os.environ.get("MONGO_TEST_URL", "mongodb://localhost:27017")
REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379")


@pytest.fixture
def base_env() -> dict[str, str]:
    """Entorno válido apuntando a los servicios de prueba (services de CI o Docker local)."""
    return {
        "ENV": "test",
        "PORT": "8000",
        "MONGO_URL": MONGO_TEST_URL,
        "MONGO_DB": f"analytics_{uuid.uuid4().hex[:8]}",
        "REDIS_URL": REDIS_TEST_URL,
        "APP_VERSION": "0.1.0",
        "GIT_SHA": "abc1234",
    }
