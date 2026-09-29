#!/bin/sh
# Rollback de un entorno a una versión anterior (runbook: docs/runbooks/rollback.md).
# Uso: scripts/rollback.sh <staging|production> <tag-o-sha> [--migrate-down | --restore-backup[=<clave>]]
#
# --migrate-down: antes de volver al ref, revierte las migraciones que el ref no tiene. Se hace
#   redesplegando la versión ACTUAL de api (es la que contiene sus `down`) con MIGRATION_ACTION.
# --restore-backup: despliega el ref restaurando antes el respaldo del bucket (por defecto el
#   más reciente); para migraciones destructivas.
# Salida: 0 ok, 1 ref inexistente o fallo de la reversión, 2 uso incorrecto.
set -eu
GH="${GH:-gh}"
USAGE="Uso: $0 <staging|production> <tag-o-sha> [--migrate-down | --restore-backup[=<clave>]]"

ENVIRONMENT="${1:-}"; REF="${2:-}"; OPTION="${3:-}"
case "$ENVIRONMENT" in
  staging | production) ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
[ -n "$REF" ] || { echo "Falta el tag o SHA de destino" >&2; exit 2; }
case "$OPTION" in
  "" | --migrate-down | --restore-backup | --restore-backup=?*) ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac

git fetch --quiet --tags origin 2>/dev/null || true
if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
  echo "El ref '$REF' no existe en el repositorio" >&2
  exit 1
fi
# actions/checkout solo acepta tags, ramas o SHA completos: un SHA corto se expande.
if ! git rev-parse --verify --quiet "refs/tags/$REF" >/dev/null; then
  REF=$(git rev-parse "$REF^{commit}")
fi

watch_last_run() {
  sleep 5
  run_id=$("$GH" run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')
  "$GH" run watch "$run_id" --exit-status
}

case "$OPTION" in
  --restore-backup*)
    key="${OPTION#--restore-backup}"; key="${key#=}"
    echo "Desplegando ${REF} en ${ENVIRONMENT} y restaurando el respaldo ${key:-latest}…"
    "$GH" workflow run deploy.yml -f environment="$ENVIRONMENT" -f ref="$REF" \
      -f action=restore-backup -f backup_key="${key:-latest}"
    ;;
  *)
    if [ "$OPTION" = "--migrate-down" ]; then
      echo "1/2 Revirtiendo en ${ENVIRONMENT} las migraciones que ${REF} no tiene…"
      "$GH" workflow run deploy.yml -f environment="$ENVIRONMENT" -f ref="$REF" -f action=migrate-down
      watch_last_run || { echo "La reversión de las migraciones falló" >&2; exit 1; }
    fi
    echo "Redesplegando ${REF} en ${ENVIRONMENT}…"
    "$GH" workflow run deploy.yml -f environment="$ENVIRONMENT" -f ref="$REF" -f action=deploy
    ;;
esac
echo "Sigue el despliegue con: gh run watch \$(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')"
