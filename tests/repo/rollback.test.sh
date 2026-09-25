#!/bin/sh
# Pruebas de scripts/rollback.sh. GH se sustituye por un stub que registra las invocaciones.
set -u
SCRIPT="$(dirname "$0")/../../scripts/rollback.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/gh" <<'STUB'
#!/bin/sh
echo "gh $*" >> "$GH_LOG"
STUB
chmod +x "$tmp/gh"
export GH="$tmp/gh" GH_LOG="$tmp/calls.log"
ref=$(git rev-parse --short HEAD)

# 1. Entorno inválido.
: > "$GH_LOG"; sh "$SCRIPT" qa "$ref" >/dev/null 2>&1; code=$?
[ "$code" = "2" ]; check $? "un entorno inválido termina con código 2"
[ ! -s "$GH_LOG" ]; check $? "no invoca gh con un entorno inválido"

# 2. Ref inexistente.
: > "$GH_LOG"; sh "$SCRIPT" staging no-existe-este-ref >/dev/null 2>&1; code=$?
[ "$code" = "1" ]; check $? "un ref inexistente termina con código 1"
[ ! -s "$GH_LOG" ]; check $? "no invoca gh con un ref inexistente"

# 3. Rollback de código.
: > "$GH_LOG"; sh "$SCRIPT" production "$ref" >/dev/null 2>&1; code=$?
[ "$code" = "0" ]; check $? "rollback válido termina con código 0"
grep -q "workflow run deploy.yml -f environment=production -f ref=$ref -f action=deploy" "$GH_LOG"; check $? "redespliega el ref en el entorno"
[ "$(wc -l < "$GH_LOG" | tr -d ' ')" = "1" ]; check $? "sin --migrate-down no revierte migraciones"

# 4. Con --migrate-down: revierte la migración ANTES de redesplegar el código anterior.
: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" --migrate-down >/dev/null 2>&1; code=$?
[ "$code" = "0" ]; check $? "rollback con --migrate-down termina con código 0"
first=$(sed -n 1p "$GH_LOG"); last=$(tail -n 1 "$GH_LOG")
echo "$first" | grep -q "action=migrate-down"; check $? "primero revierte la migración"
grep -q "run watch" "$GH_LOG"; check $? "espera a que termine la reversión de la migración"
echo "$last" | grep -q "action=deploy"; check $? "después redespliega el código"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
