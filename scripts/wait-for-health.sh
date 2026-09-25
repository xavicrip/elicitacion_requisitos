#!/bin/sh
# Espera a que una URL responda HTTP 200 y, opcionalmente, a que el cuerpo contenga un texto
# (p. ej., el commit recién desplegado en /version: la versión anterior también está sana).
# Uso: wait-for-health.sh <url> [timeout_s=300] [intervalo_s=5] [texto_esperado]
# Salida: 0 si se cumple a tiempo, 1 si se agota el timeout, 2 si el uso es incorrecto.
set -u

URL="${1:-}"
TIMEOUT="${2:-300}"
INTERVAL="${3:-5}"
EXPECTED="${4:-}"
[ -n "$URL" ] || { echo "Uso: $0 <url> [timeout_s] [intervalo_s] [texto_esperado]" >&2; exit 2; }

deadline=$(( $(date +%s) + TIMEOUT ))
body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
attempt=0
while :; do
  attempt=$((attempt + 1))
  code=$(curl -s -o "$body_file" -w '%{http_code}' --max-time 5 "$URL" || true)
  if [ "$code" = "200" ] && { [ -z "$EXPECTED" ] || grep -qF -- "$EXPECTED" "$body_file"; }; then
    echo "✓ $URL respondió 200${EXPECTED:+ con \"$EXPECTED\"} (intento $attempt)"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "✗ $URL no respondió 200${EXPECTED:+ con \"$EXPECTED\"} en ${TIMEOUT}s (último código: ${code:-sin respuesta})" >&2
    exit 1
  fi
  sleep "$INTERVAL"
done
