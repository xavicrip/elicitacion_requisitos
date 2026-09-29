#!/bin/sh
# Imprime la migración más antigua AÑADIDA entre dos refs (solo el nombre del archivo).
# Es el argumento de MIGRATION_ACTION=down:<archivo> para volver de <hasta> a <desde>.
# Uso: first-new-migration.sh <desde> <hasta>   (salida vacía = ninguna)
set -eu
FROM="$1"; TO="$2"
git diff --name-only --diff-filter=A "$FROM" "$TO" -- apps/api/migrations \
  | sed -n 's|^apps/api/migrations/\([0-9]\{14\}-[A-Za-z0-9_-]*\.js\)$|\1|p' \
  | sort | head -n 1
