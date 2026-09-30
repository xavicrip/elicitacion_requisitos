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
full=$(git rev-parse HEAD)

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
grep -q "workflow run deploy.yml -f environment=production -f ref=$full -f action=deploy" "$GH_LOG"; check $? "redespliega el ref (un SHA corto se expande al completo)"
[ "$(wc -l < "$GH_LOG" | tr -d ' ')" = "1" ]; check $? "sin --migrate-down no revierte migraciones"

# 4. Con --migrate-down: revierte la migración ANTES de redesplegar el código anterior.
: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" --migrate-down >/dev/null 2>&1; code=$?
[ "$code" = "0" ]; check $? "rollback con --migrate-down termina con código 0"
first=$(sed -n 1p "$GH_LOG"); last=$(tail -n 1 "$GH_LOG")
echo "$first" | grep -q "action=migrate-down"; check $? "primero revierte la migración"
grep -q "run watch" "$GH_LOG"; check $? "espera a que termine la reversión de la migración"
echo "$last" | grep -q "action=deploy"; check $? "después redespliega el código"
echo "$first" | grep -q "from_ref=$"; check $? "sin =<desde> revierte desde la versión desplegada"

# 4b. --migrate-down=<desde> (tras un Rollback del panel): pasa la versión mala expandida.
: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" "--migrate-down=$ref" >/dev/null 2>&1; code=$?
[ "$code" = "0" ]; check $? "rollback con --migrate-down=<desde> termina con código 0"
sed -n 1p "$GH_LOG" | grep -q "action=migrate-down -f from_ref=$full"; check $? "pasa la versión que contiene los down"
: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" --migrate-down=no-existe >/dev/null 2>&1; code=$?
[ "$code" = "1" ] && [ ! -s "$GH_LOG" ]; check $? "una versión <desde> inexistente termina con 1 sin invocar gh"

# 5. Con --restore-backup: un solo despliegue del ref que restaura el respaldo.
: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" --restore-backup >/dev/null 2>&1; code=$?
[ "$code" = "0" ]; check $? "rollback con --restore-backup termina con código 0"
grep -q "ref=$full -f action=restore-backup -f backup_key=latest" "$GH_LOG"; check $? "restaura el respaldo más reciente por defecto"
[ "$(grep -c 'workflow run' "$GH_LOG")" = "1" ]; check $? "la restauración es un único despliegue"

: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" --restore-backup=mongo-backups/x.ndjson.gz >/dev/null 2>&1
grep -q "backup_key=mongo-backups/x.ndjson.gz" "$GH_LOG"; check $? "acepta una clave de respaldo concreta"

# 6. Opción desconocida.
: > "$GH_LOG"; sh "$SCRIPT" staging "$ref" --borrar-todo >/dev/null 2>&1; code=$?
[ "$code" = "2" ]; check $? "una opción desconocida termina con código 2"
[ ! -s "$GH_LOG" ]; check $? "no invoca gh con una opción desconocida"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
