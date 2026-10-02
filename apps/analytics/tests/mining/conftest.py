"""Pruebas con los modelos del grupo `mining` (job `analysis-eval`, plan de la 007, ajuste 16).

En `test-python` (sin ese grupo) se omiten: `uv run --group mining pytest tests/mining`.
"""

import pytest

pytest.importorskip("spacy", reason="requiere el grupo de dependencias mining")
