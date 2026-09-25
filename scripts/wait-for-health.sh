#!/bin/sh
# Espera a que una URL responda HTTP 200 (p. ej., /health tras un despliegue).
# Uso: wait-for-health.sh <url> [timeout_s=300] [intervalo_s=5]
# Salida: 0 si responde 200 a tiempo, 1 si se agota el timeout, 2 si el uso es incorrecto.
set -u

URL="${1:-}"
TIMEOUT="${2:-300}"
INTERVAL="${3:-5}"
[ -n "$URL" ] || { echo "Uso: $0 <url> [timeout_s] [intervalo_s]" >&2; exit 2; }

deadline=$(( $(date +%s) + TIMEOUT ))
attempt=0
while :; do
  attempt=$((attempt + 1))
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL" || true)
  if [ "$code" = "200" ]; then
    echo "✓ $URL respondió 200 (intento $attempt)"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "✗ $URL no respondió 200 en ${TIMEOUT}s (último código: ${code:-sin respuesta})" >&2
    exit 1
  fi
  sleep "$INTERVAL"
done
