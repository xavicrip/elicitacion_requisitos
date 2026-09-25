"""Configuración del servicio (specs/001-plataforma-base/contracts/env-vars.md)."""

import os
from collections.abc import Mapping
from typing import Literal

from pydantic import Field, RedisDsn, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    env: Literal["development", "test", "production"] = Field(validation_alias="ENV")
    port: int = Field(validation_alias="PORT", ge=1, le=65535)
    host: str = Field(default="::", validation_alias="HOST")
    mongo_url: str = Field(validation_alias="MONGO_URL", pattern=r"^mongodb(\+srv)?://")
    mongo_db: str = Field(validation_alias="MONGO_DB", min_length=1)
    redis_url: RedisDsn = Field(validation_alias="REDIS_URL")
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = Field(
        default="INFO", validation_alias="LOG_LEVEL"
    )
    git_sha: str = Field(default="unknown", validation_alias="GIT_SHA")
    app_version: str = Field(default="dev", validation_alias="APP_VERSION")


class ConfigError(Exception):
    """Configuración inválida: nombra las variables afectadas, nunca sus valores."""

    def __init__(self, variables: list[str]) -> None:
        self.variables = variables
        super().__init__(
            "Configuración inválida o incompleta. Revisa las variables: " + ", ".join(variables)
        )


def load_settings(source: Mapping[str, str] | None = None) -> Settings:
    values = dict(os.environ if source is None else source)
    cleaned = {key: value for key, value in values.items() if value != ""}
    try:
        return Settings.model_validate(cleaned)
    except ValidationError as error:
        variables = sorted({str(issue["loc"][0]) for issue in error.errors()})
        raise ConfigError(variables) from None
