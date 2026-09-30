#!/bin/sh
# Genera /config.js con la configuración de ejecución y arranca el comando (Caddy).
# Así la misma imagen sirve para staging y producción (build once, deploy many).
set -eu

WEB_ROOT="${WEB_ROOT:-/srv}"
API_INTERNAL_URL="${API_INTERNAL_URL:-}"
API_PUBLIC_URL="${API_PUBLIC_URL:-}"
APP_VERSION="${APP_VERSION:-dev}"
# Ganchos de los E2E (window.__canvasState): solo Compose y CI, nunca Railway.
E2E_HOOKS="${E2E_HOOKS:-false}"

fail() {
  printf '{"level":"fatal","msg":"%s","variables":["%s"]}\n' "$1" "$2" >&2
  exit 1
}

# Solo URLs http(s) sin comillas, espacios ni barras invertidas.
valid_url() { echo "$1" | grep -Eq '^https?://[^"\\ <>]+$'; }

# Destino del proxy /api (Caddyfile): red privada de Railway o servicio `api` de Compose.
[ -n "$API_INTERNAL_URL" ] || fail "Configuración incompleta" "API_INTERNAL_URL"
valid_url "$API_INTERNAL_URL" || fail "Valor inválido" "API_INTERNAL_URL"

# Opcional desde la feature 002: el frontend llama a la API con rutas relativas (/api).
if [ -n "$API_PUBLIC_URL" ]; then
  valid_url "$API_PUBLIC_URL" || fail "Valor inválido" "API_PUBLIC_URL"
fi
echo "$APP_VERSION" | grep -Eq '^[A-Za-z0-9._+-]+$' || fail "Valor inválido" "APP_VERSION"

# Cualquier valor distinto de "true" deja los ganchos desactivados.
[ "$E2E_HOOKS" = "true" ] && e2e_hooks=true || e2e_hooks=false

printf 'window.__REQCANVAS_CONFIG__={"apiUrl":"%s","version":"%s","e2eHooks":%s};\n' \
  "$API_PUBLIC_URL" "$APP_VERSION" "$e2e_hooks" > "$WEB_ROOT/config.js"

exec "$@"
