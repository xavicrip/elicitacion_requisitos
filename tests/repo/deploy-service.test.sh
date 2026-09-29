#!/bin/sh
# Pruebas de scripts/railway/deploy-service.sh. RAILWAY se sustituye por un stub que devuelve,
# en cada consulta, el siguiente estado de $STATES para el despliegue subido.
set -u
SCRIPT="$(dirname "$0")/../../scripts/railway/deploy-service.sh"
fails=0
check() { if [ "$1" = "0" ]; then echo "ok - $2"; else echo "FALLA - $2"; fails=$((fails + 1)); fi; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/railway" <<'STUB'
#!/bin/sh
echo "railway $*" >> "$LOG"
case "$1" in
  up)
    # Guarda el mensaje del despliegue (argumento de --message).
    while [ $# -gt 0 ]; do [ "$1" = "--message" ] && echo "$2" > "$STATE_DIR/message"; shift; done ;;
  deployment)
    n=$(cat "$STATE_DIR/n" 2>/dev/null || echo 1)
    status=$(echo "$STATES" | cut -d' ' -f"$n"); echo $((n + 1)) > "$STATE_DIR/n"
    msg=$(cat "$STATE_DIR/message")
    printf '[{"status":"%s","meta":{"cliMessage":"%s"}},{"status":"SUCCESS","meta":{"cliMessage":"anterior"}}]\n' "$status" "$msg" ;;
esac
STUB
chmod +x "$tmp/railway"
export RAILWAY="$tmp/railway" LOG="$tmp/calls.log" STATE_DIR="$tmp" DEPLOY_POLL_INTERVAL=0

run() { : > "$LOG"; rm -f "$tmp/n" "$tmp/message"; STATES="$1" DEPLOY_TIMEOUT="${2:-10}" \
  sh "$SCRIPT" api staging v1.2.3 abc1234 >/dev/null 2>&1; }

# 1. BUILDING → DEPLOYING → SUCCESS.
STATES_OK="BUILDING DEPLOYING SUCCESS"
run "$STATES_OK"; code=$?
[ "$code" = "0" ]; check $? "termina con 0 cuando el despliegue llega a SUCCESS"
grep -q "variables --service api --environment staging --skip-deploys --set APP_VERSION=v1.2.3 --set GIT_SHA=abc1234" "$LOG"
check $? "fija APP_VERSION y GIT_SHA sin redesplegar"
grep -q "up --detach --service api --environment staging --message v1.2.3 (abc1234)" "$LOG"
check $? "sube el código sin adjuntarse al stream de logs"

# 2. Build fallido.
run "BUILDING FAILED"; code=$?
[ "$code" = "1" ]; check $? "termina con 1 si el despliegue falla"

# 3. Nunca termina: agota el tiempo (el despliegue anterior en SUCCESS no cuenta).
run "BUILDING BUILDING BUILDING BUILDING" 3; code=$?
[ "$code" = "1" ]; check $? "termina con 1 si el despliegue no termina a tiempo"

[ "$fails" = "0" ] || { echo "$fails prueba(s) fallida(s)"; exit 1; }
