#!/bin/sh
# Rollback de un entorno a una versión anterior (runbook: docs/runbooks/rollback.md).
# Uso: scripts/rollback.sh <staging|production> <tag-o-sha> [--migrate-down]
#
# Con --migrate-down revierte primero la última migración: debe hacerse con el código NUEVO
# desplegado (es el que contiene el `down` de esa migración) y antes de volver al anterior.
# Salida: 0 ok, 1 ref inexistente o fallo de la reversión, 2 uso incorrecto.
set -eu
GH="${GH:-gh}"

ENVIRONMENT="${1:-}"; REF="${2:-}"; MIGRATE_DOWN="${3:-}"
case "$ENVIRONMENT" in
  staging | production) ;;
  *) echo "Uso: $0 <staging|production> <tag-o-sha> [--migrate-down]" >&2; exit 2 ;;
esac
[ -n "$REF" ] || { echo "Falta el tag o SHA de destino" >&2; exit 2; }

git fetch --quiet --tags origin 2>/dev/null || true
if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
  echo "El ref '$REF' no existe en el repositorio" >&2
  exit 1
fi

if [ "$MIGRATE_DOWN" = "--migrate-down" ]; then
  echo "1/2 Revirtiendo la última migración en ${ENVIRONMENT}…"
  "$GH" workflow run deploy.yml -f environment="$ENVIRONMENT" -f ref="$REF" -f action=migrate-down
  sleep 5
  run_id=$("$GH" run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
  "$GH" run watch "$run_id" --exit-status || { echo "La reversión de la migración falló" >&2; exit 1; }
fi

echo "Redesplegando ${REF} en ${ENVIRONMENT}…"
"$GH" workflow run deploy.yml -f environment="$ENVIRONMENT" -f ref="$REF" -f action=deploy
echo "Sigue el despliegue con: gh run watch \$(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')"
