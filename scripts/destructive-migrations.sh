#!/bin/sh
# Lista las migraciones AÑADIDAS entre dos refs que declaran `destructive = true`.
# Uso: destructive-migrations.sh <desde> <hasta>   (salida vacía = ninguna)
set -eu
FROM="$1"; TO="$2"
git diff --name-only --diff-filter=A "$FROM" "$TO" -- apps/api/migrations | while read -r file; do
  case "$file" in *sample-migration.js) continue ;; esac
  if git show "$TO:$file" | grep -qE 'destructive\s*=\s*true'; then echo "$file"; fi
done
