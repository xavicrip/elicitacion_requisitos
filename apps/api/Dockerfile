# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @reqcanvas/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @reqcanvas/api build \
 && pnpm --filter @reqcanvas/api deploy --legacy --prod /out \
 && rm -rf /out/src /out/tests

FROM node:24-alpine AS runtime
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV NODE_ENV=production APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# Migraciones: `node dist/migrate.js up` (preDeployCommand de Railway).
CMD ["node", "dist/server.js"]
