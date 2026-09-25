#!/bin/sh
# Despliega un servicio en Railway desde el código del runner (`railway up`).
# Uso: deploy-service.sh <servicio> <entorno> <versión> <commit>
# Requiere RAILWAY_TOKEN (project token del entorno). Se ejecuta desde la raíz del repositorio.
set -eu
SERVICE="$1"; ENVIRONMENT="$2"; VERSION="$3"; COMMIT="$4"

# APP_VERSION y GIT_SHA: Railway los pasa como build args (ARG en los Dockerfiles) y como
# variables de ejecución; /version los devuelve (T056).
railway variables --service "$SERVICE" --environment "$ENVIRONMENT" --skip-deploys \
  --set "APP_VERSION=$VERSION" --set "GIT_SHA=$COMMIT" >/dev/null

railway up --ci --service "$SERVICE" --environment "$ENVIRONMENT" \
  --message "$VERSION ($COMMIT)"
