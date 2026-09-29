#!/bin/sh
# Pruebas de scripts/first-new-migration.sh (argumento de MIGRATION_ACTION=down:<archivo>).
set -u
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/first-new-migration.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

repo=$(mktemp -d); trap 'rm -rf "$repo"' EXIT
cd "$repo" && git init -q && git config user.email t@t && git config user.name t
mkdir -p apps/api/migrations
echo 'export const destructive = false;' > apps/api/migrations/20260101000000-a.js
echo '// plantilla' > apps/api/migrations/sample-migration.js
git add -A && git commit -qm base && git tag v0.1.0

# 1. Sin migraciones nuevas: salida vacía.
echo doc > README.md && git add -A && git commit -qm docs
out=$(sh "$SCRIPT" v0.1.0 HEAD); code=$?
[ "$code" = "0" ] && [ -z "$out" ]; check $? "sin migraciones nuevas no imprime nada"

# 2. Varias migraciones nuevas: la más antigua, solo el nombre del archivo.
echo 'x' > apps/api/migrations/20260103000000-c.js
echo 'x' > apps/api/migrations/20260102000000-b.js
echo 'x' > apps/api/migrations/sample-migration-2.js
git add -A && git commit -qm bc
[ "$(sh "$SCRIPT" v0.1.0 HEAD)" = "20260102000000-b.js" ]; check $? "imprime la migración nueva más antigua"

# 3. Modificar una migración existente no cuenta como nueva.
echo '// cambio' >> apps/api/migrations/20260101000000-a.js
git add -A && git commit -qm edit && git tag v0.1.1
[ -z "$(sh "$SCRIPT" v0.1.1 HEAD)" ]; check $? "una migración modificada no se considera nueva"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
