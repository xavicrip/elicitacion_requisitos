#!/bin/sh
# Pruebas del script de arranque del contenedor web (FR-005: validar configuración).
set -u
SCRIPT="$(dirname "$0")/../docker-entrypoint.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 1. Sin API_PUBLIC_URL: termina con código 1 y nombra la variable.
out=$(env -i PATH="$PATH" WEB_ROOT="$tmp" sh "$SCRIPT" true 2>&1); code=$?
[ "$code" = "1" ]; check $? "sin API_PUBLIC_URL termina con código 1"
echo "$out" | grep -q "API_PUBLIC_URL"; check $? "el error nombra API_PUBLIC_URL"

# 2. Con un valor inválido no se escribe config.js y no se muestra el valor.
out=$(env -i PATH="$PATH" WEB_ROOT="$tmp" API_PUBLIC_URL='javascript:alert("s3cret")' sh "$SCRIPT" true 2>&1); code=$?
[ "$code" = "1" ]; check $? "URL inválida termina con código 1"
echo "$out" | grep -q "s3cret"; [ $? -ne 0 ]; check $? "el error no muestra el valor"
[ ! -f "$tmp/config.js" ]; check $? "no se genera config.js con una URL inválida"

# 3. Con configuración válida genera /config.js y ejecuta el comando.
env -i PATH="$PATH" WEB_ROOT="$tmp" API_PUBLIC_URL="https://api.example.com" APP_VERSION="0.1.0" sh "$SCRIPT" true; code=$?
[ "$code" = "0" ]; check $? "con configuración válida arranca"
grep -q '"apiUrl":"https://api.example.com"' "$tmp/config.js"; check $? "config.js contiene apiUrl"
grep -q '"version":"0.1.0"' "$tmp/config.js"; check $? "config.js contiene la versión"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
