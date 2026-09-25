#!/bin/sh
# Pruebas de scripts/wait-for-health.sh (espera a que una URL responda 200).
set -u
SCRIPT="$(dirname "$0")/../../scripts/wait-for-health.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

tmp=$(mktemp -d); pids=""
cleanup() { for p in $pids; do kill "$p" 2>/dev/null; done; rm -rf "$tmp"; }
trap cleanup EXIT
echo ok > "$tmp/health"
port=$((20000 + $$ % 20000))

# 1. Sin servidor: falla al agotar el timeout.
start=$(date +%s)
sh "$SCRIPT" "http://127.0.0.1:$port/health" 3 1 >/dev/null 2>&1; code=$?
[ "$code" = "1" ]; check $? "sin servidor termina con código 1"
[ $(( $(date +%s) - start )) -le 6 ]; check $? "respeta el timeout"

# 2. El servidor arranca tarde: espera y termina con éxito.
(sleep 2; exec python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp") >/dev/null 2>&1 &
pids="$pids $!"
sh "$SCRIPT" "http://127.0.0.1:$port/health" 20 1 >/dev/null 2>&1; code=$?
[ "$code" = "0" ]; check $? "espera a que el servicio responda 200"

# 3. Un 404 no cuenta como saludable.
sh "$SCRIPT" "http://127.0.0.1:$port/no-existe" 3 1 >/dev/null 2>&1; code=$?
[ "$code" = "1" ]; check $? "un 404 no cuenta como saludable"

# 4. Sin argumentos: uso incorrecto (código 2).
sh "$SCRIPT" >/dev/null 2>&1; code=$?
[ "$code" = "2" ]; check $? "sin URL termina con código 2"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
