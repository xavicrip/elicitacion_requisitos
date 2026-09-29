#!/bin/sh
# Despliega un servicio en Railway desde el código del runner (`railway up`).
# Uso: deploy-service.sh <servicio> <entorno> <versión> <commit>
# Requiere RAILWAY_TOKEN (project token del entorno) y jq. Se ejecuta desde la raíz del repositorio.
# Salida: 0 si el despliegue llega a SUCCESS; 1 si falla o no termina en DEPLOY_TIMEOUT segundos.
set -eu
SERVICE="$1"; ENVIRONMENT="$2"; VERSION="$3"; COMMIT="$4"
RAILWAY="${RAILWAY:-railway}"
TIMEOUT="${DEPLOY_TIMEOUT:-1500}"; INTERVAL="${DEPLOY_POLL_INTERVAL:-15}"

# APP_VERSION y GIT_SHA: Railway los pasa como build args (ARG en los Dockerfiles) y como
# variables de ejecución; /version los devuelve (T056).
"$RAILWAY" variables --service "$SERVICE" --environment "$ENVIRONMENT" --skip-deploys \
  --set "APP_VERSION=$VERSION" --set "GIT_SHA=$COMMIT" >/dev/null

# `railway up --ci` falla si se corta el stream de logs de build aunque el build siga en Railway
# ("Failed to stream build logs"). Se sube sin adjuntarse y se sigue el estado del despliegue.
message="$VERSION ($COMMIT) #$(date +%s)"
"$RAILWAY" up --detach --service "$SERVICE" --environment "$ENVIRONMENT" --message "$message" >/dev/null

elapsed=0; status=""
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  status=$("$RAILWAY" deployment list --service "$SERVICE" --environment "$ENVIRONMENT" \
    --limit 10 --json 2>/dev/null \
    | jq -r --arg m "$message" '[.[] | select(.meta.cliMessage == $m)][0].status // "PENDING"') \
    || status="PENDING"
  case "$status" in
    SUCCESS) echo "$SERVICE: SUCCESS (${elapsed}s)"; exit 0 ;;
    FAILED | CRASHED | REMOVED | SKIPPED)
      echo "$SERVICE: despliegue $status; revisa sus logs en el panel de Railway" >&2; exit 1 ;;
  esac
  # Cada consulta cuenta al menos 1 s, aunque el intervalo sea 0 (pruebas).
  sleep "$INTERVAL"; elapsed=$((elapsed + (INTERVAL > 0 ? INTERVAL : 1)))
done
echo "$SERVICE: el despliegue no terminó en ${TIMEOUT}s (último estado: ${status:-desconocido})" >&2
exit 1
