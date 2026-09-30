#!/bin/sh
# Pruebas del proxy /api de web (feature 002, research R2, plan ajuste 2): estructura del
# Caddyfile. El proxy en funcionamiento lo comprueban el smoke (`/api/health`) y los E2E.
set -u
CADDYFILE="$(dirname "$0")/../../apps/web/Caddyfile"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

grep -Eq '^\s*handle_path /api/\* \{' "$CADDYFILE"
check $? "handle_path /api/* quita el prefijo /api antes de reenviar"

grep -Eq 'reverse_proxy \{\$API_INTERNAL_URL\}' "$CADDYFILE"
check $? "reenvía a {\$API_INTERNAL_URL} (red privada de Railway o servicio de Compose)"

api_line=$(grep -n 'handle_path /api/\*' "$CADDYFILE" | cut -d: -f1)
spa_line=$(grep -n 'try_files {path} /index.html' "$CADDYFILE" | cut -d: -f1)
[ -n "$api_line" ] && [ -n "$spa_line" ] && [ "$api_line" -lt "$spa_line" ]
check $? "el proxy se evalúa antes del fallback de la SPA"

grep -Eq 'header_up X-Real-IP \{client_real_ip\}' "$CADDYFILE"
check $? "reenvía X-Real-IP (el del borde de Railway o, sin él, la IP de quien conecta)"

grep -Eq 'map \{http\.request\.header\.X-Real-IP\} \{client_real_ip\}' "$CADDYFILE"
check $? "calcula client_real_ip a partir de X-Real-IP"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
