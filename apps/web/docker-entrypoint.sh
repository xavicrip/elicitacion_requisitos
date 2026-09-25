#!/bin/sh
# Genera /config.js con la configuración de ejecución y arranca el comando (Caddy).
# Así la misma imagen sirve para staging y producción (build once, deploy many).
set -eu

WEB_ROOT="${WEB_ROOT:-/srv}"
API_PUBLIC_URL="${API_PUBLIC_URL:-}"
APP_VERSION="${APP_VERSION:-dev}"

fail() {
  printf '{"level":"fatal","msg":"%s","variables":["%s"]}\n' "$1" "$2" >&2
  exit 1
}

[ -n "$API_PUBLIC_URL" ] || fail "Configuración incompleta" "API_PUBLIC_URL"
# Solo URLs http(s) sin comillas, espacios ni barras invertidas: se inyectan en JavaScript.
echo "$API_PUBLIC_URL" | grep -Eq '^https?://[^"\\ <>]+$' || fail "Valor inválido" "API_PUBLIC_URL"
echo "$APP_VERSION" | grep -Eq '^[A-Za-z0-9._+-]+$' || fail "Valor inválido" "APP_VERSION"

printf 'window.__REQCANVAS_CONFIG__={"apiUrl":"%s","version":"%s"};\n' \
  "$API_PUBLIC_URL" "$APP_VERSION" > "$WEB_ROOT/config.js"

exec "$@"
