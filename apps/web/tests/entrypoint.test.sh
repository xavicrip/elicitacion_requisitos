#!/bin/sh
# Pruebas del script de arranque del contenedor web (FR-005: validar configuración).
set -u
SCRIPT="$(dirname "$0")/../docker-entrypoint.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

INTERNAL="API_INTERNAL_URL=http://api.railway.internal:3000"

# 1. Sin API_INTERNAL_URL (destino del proxy /api): termina con código 1 y nombra la variable.
out=$(env -i PATH="$PATH" WEB_ROOT="$tmp" sh "$SCRIPT" true 2>&1); code=$?
[ "$code" = "1" ]; check $? "sin API_INTERNAL_URL termina con código 1"
echo "$out" | grep -q "API_INTERNAL_URL"; check $? "el error nombra API_INTERNAL_URL"

# 2. API_INTERNAL_URL inválida: no se muestra el valor.
out=$(env -i PATH="$PATH" WEB_ROOT="$tmp" API_INTERNAL_URL='ftp://s3cret' sh "$SCRIPT" true 2>&1); code=$?
[ "$code" = "1" ]; check $? "API_INTERNAL_URL inválida termina con código 1"
echo "$out" | grep -q "s3cret"; [ $? -ne 0 ]; check $? "el error no muestra el valor de API_INTERNAL_URL"

# 3. API_PUBLIC_URL es opcional con el proxy: sin ella, apiUrl queda vacía (rutas relativas /api).
env -i PATH="$PATH" WEB_ROOT="$tmp" "$INTERNAL" APP_VERSION="0.2.0" sh "$SCRIPT" true; code=$?
[ "$code" = "0" ]; check $? "arranca sin API_PUBLIC_URL"
grep -q '"apiUrl":""' "$tmp/config.js"; check $? "sin API_PUBLIC_URL, apiUrl queda vacía"
rm -f "$tmp/config.js"

# 4. Con un API_PUBLIC_URL inválido no se escribe config.js y no se muestra el valor.
out=$(env -i PATH="$PATH" WEB_ROOT="$tmp" "$INTERNAL" API_PUBLIC_URL='javascript:alert("s3cret")' sh "$SCRIPT" true 2>&1); code=$?
[ "$code" = "1" ]; check $? "API_PUBLIC_URL inválida termina con código 1"
echo "$out" | grep -q "s3cret"; [ $? -ne 0 ]; check $? "el error no muestra el valor"
[ ! -f "$tmp/config.js" ]; check $? "no se genera config.js con una URL inválida"

# 5. Con configuración completa genera /config.js y ejecuta el comando.
env -i PATH="$PATH" WEB_ROOT="$tmp" "$INTERNAL" API_PUBLIC_URL="https://api.example.com" APP_VERSION="0.1.0" sh "$SCRIPT" true; code=$?
[ "$code" = "0" ]; check $? "con configuración válida arranca"
grep -q '"apiUrl":"https://api.example.com"' "$tmp/config.js"; check $? "config.js contiene apiUrl"
grep -q '"version":"0.1.0"' "$tmp/config.js"; check $? "config.js contiene la versión"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
