"""Errores esperados de un job de detección (contracts/detection-job.md §Errores)."""

from typing import Literal

ErrorCode = Literal["IMAGE_DOWNLOAD_FAILED", "TIMEOUT", "INTERNAL"]


class DetectionError(Exception):
    """Fallo esperado del job: el mensaje es solo el código del contrato."""

    def __init__(self, code: ErrorCode) -> None:
        super().__init__(code)
        self.code = code
