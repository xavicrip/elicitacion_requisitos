# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio.
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @reqcanvas/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @reqcanvas/web build

FROM caddy:2-alpine AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=build /repo/apps/web/dist /srv
RUN chown -R 1000:1000 /srv /config /data
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
