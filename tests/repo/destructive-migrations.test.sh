#!/bin/sh
# Pruebas de scripts/destructive-migrations.sh (lista las migraciones destructivas añadidas).
set -u
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/destructive-migrations.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

repo=$(mktemp -d); trap 'rm -rf "$repo"' EXIT
cd "$repo" && git init -q && git config user.email t@t && git config user.name t
mkdir -p apps/api/migrations
echo 'export const destructive = false;' > apps/api/migrations/20260101000000-a.js
git add -A && git commit -qm base && git tag v0.1.0

# 1. Sin migraciones nuevas: no hay nada (antes xargs -r daba un falso positivo).
echo doc > README.md && git add -A && git commit -qm docs
out=$(sh "$SCRIPT" v0.1.0 HEAD); code=$?
[ "$code" = "0" ] && [ -z "$out" ]; check $? "sin migraciones nuevas no lista nada"

# 2. Migración nueva no destructiva: no se lista.
echo 'export const destructive = false;' > apps/api/migrations/20260102000000-b.js
git add -A && git commit -qm b
[ -z "$(sh "$SCRIPT" v0.1.0 HEAD)" ]; check $? "una migración no destructiva no se lista"

# 3. Migración nueva destructiva: se lista.
echo 'export const destructive = true;' > apps/api/migrations/20260103000000-c.js
git add -A && git commit -qm c
sh "$SCRIPT" v0.1.0 HEAD | grep -q "20260103000000-c.js"; check $? "una migración destructiva se lista"
[ "$(sh "$SCRIPT" v0.1.0 HEAD | wc -l | tr -d ' ')" = "1" ]; check $? "solo lista las destructivas"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
