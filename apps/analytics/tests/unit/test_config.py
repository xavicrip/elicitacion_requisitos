import pytest

from analytics.config import ConfigError, load_settings

VALID = {
    "ENV": "production",
    "PORT": "8000",
    "MONGO_URL": "mongodb://user:s3cret-mongo@mongo:27017",
    "MONGO_DB": "reqcanvas",
    "REDIS_URL": "redis://default:s3cret-redis@redis:6379",
}


def test_acepta_configuracion_completa_con_valores_por_defecto() -> None:
    settings = load_settings(VALID)
    assert settings.port == 8000
    assert settings.log_level == "INFO"
    assert settings.app_version == "dev"
    assert settings.host == "::"


def test_falla_nombrando_la_variable_que_falta() -> None:
    source = {k: v for k, v in VALID.items() if k != "MONGO_URL"}
    with pytest.raises(ConfigError, match="MONGO_URL"):
        load_settings(source)


def test_variable_vacia_cuenta_como_ausente() -> None:
    with pytest.raises(ConfigError, match="REDIS_URL"):
        load_settings({**VALID, "REDIS_URL": ""})


def test_lista_variables_invalidas_sin_mostrar_valores() -> None:
    with pytest.raises(ConfigError) as info:
        load_settings({**VALID, "PORT": "abc", "REDIS_URL": "s3cret-redis sin esquema"})
    message = str(info.value)
    assert "PORT" in message
    assert "REDIS_URL" in message
    assert "s3cret" not in message
    assert set(info.value.variables) >= {"PORT", "REDIS_URL"}
