# syntax=docker/dockerfile:1
# Contexto de build: raíz del repositorio.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY apps/analytics/pyproject.toml apps/analytics/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/analytics/src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim-bookworm AS runtime
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /app/.venv /app/.venv
USER app
EXPOSE 8000
CMD ["python", "-m", "analytics.main"]
