# ReqCanvas

Sistema web colaborativo para levantar requisitos a partir de diagramas UML de actividades:
los participantes registran escenarios **Dado / Cuando / Entonces** sobre cada actividad de un
diagrama, y el administrador los analiza con técnicas de minería de datos y de texto.

- Visión y alcance: [`prompt.md`](prompt.md)
- Principios del proyecto: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- Roadmap y specs (spec-kit): [`specs/`](specs/) — una rama por feature (`NNN-nombre`)

## Arquitectura

| Servicio           | Tecnología                                                              | Puerto local       |
| ------------------ | ----------------------------------------------------------------------- | ------------------ |
| `web`              | React + Vite + three.js, servido por Caddy                              | 5173               |
| `api`              | Node.js 24 + Fastify + Mongoose                                         | 3000               |
| `analytics`        | Python 3.12 + FastAPI                                                   | 8000               |
| `analytics-worker` | Python 3.12 + BullMQ, OpenCV y Tesseract (misma imagen que `analytics`) | (solo red interna) |
| `mongodb`          | MongoDB 7                                                               | (solo red interna) |
| `redis`            | Redis 7                                                                 | (solo red interna) |
| `s3`               | RustFS (bucket S3; en Railway, un Bucket)                               | (solo red interna) |

```text
apps/web          Frontend
apps/api          API REST (y tiempo real a partir de la feature 005)
apps/analytics    Servicio analítico (OCR, detección, minería de texto)
packages/shared   Esquemas zod y tipos compartidos (contratos web ⇄ api)
infra/            Docker Compose para desarrollo local
e2e/              Pruebas de humo (Playwright)
```

## Prerrequisitos

- **Docker** con Compose v2 (Docker Desktop en macOS/Windows).
- **Node.js 24 LTS** (fijado en [`.nvmrc`](.nvmrc); con nvm: `nvm install && nvm use`).
- **pnpm 10** mediante Corepack: `corepack enable` (la versión la fija `packageManager`).
- **Python 3.12** y **[uv](https://docs.astral.sh/uv/)** (uv descarga Python 3.12 si hace falta).

## Arranque local

```bash
git clone https://github.com/xavicrip/elicitacion_requisitos.git reqcanvas
cd reqcanvas
pnpm install                       # dependencias de Node + hooks de git (Husky)
(cd apps/analytics && uv sync)     # dependencias de Python
pnpm dev:up                        # construye y levanta los 6 servicios con Docker Compose
```

`pnpm dev:up` aplica las migraciones de MongoDB antes de arrancar la API (igual que el
_pre-deploy_ de Railway). Para detenerlo todo: `pnpm dev:down`.

### Verificar que todo está saludable

```bash
curl -s localhost:3000/health | jq .status                         # "ok"  (api: mongo + redis)
curl -s localhost:3000/health/deep | jq .checks.analytics.status   # "up"  (analytics vía api)
curl -s localhost:8000/health | jq .status                         # "ok"  (analytics, solo en local)
curl -s -o /dev/null -w "%{http_code}\n" localhost:5173/health     # 200   (web)
open http://localhost:5173                                         # "ReqCanvas" y la versión
```

Si una dependencia falla, `/health` responde **503** con `status: "degraded"` e indica cuál:

```bash
docker compose -f infra/docker-compose.yml stop mongodb
curl -s -w "\n%{http_code}\n" localhost:3000/health   # 503, checks.mongo.status = "down"
docker compose -f infra/docker-compose.yml start mongodb
```

### Cuentas y proyectos (feature 002)

En local, `accounts` está activado: en `http://localhost:5173` puedes crear una cuenta
(`/registro`), iniciar sesión (`/entrar`), crear proyectos en "Mis proyectos" (`/proyectos`),
gestionar miembros e invitar con un enlace (`/invitacion/<token>`). `web` reenvía `/api/*` a
`api` (mismo origen: la cookie de sesión funciona con `SameSite=Strict`); ver
[ADR 0004](docs/adr/0004-sesion-y-proxy.md) y el
[quickstart de la 002](specs/002-auth-proyectos/quickstart.md).

| Servicio | Variable           | Obligatoria | Uso                                                           |
| -------- | ------------------ | ----------- | ------------------------------------------------------------- |
| `api`    | `JWT_SECRET`       | Sí          | Firma de los access tokens (≥ 32 bytes, distinto por entorno) |
| `api`    | `APP_BASE_URL`     | Sí          | URL pública de `web`; base de los enlaces de invitación       |
| `api`    | `JWT_ACCESS_TTL`   | No (`15m`)  | Duración del access token                                     |
| `api`    | `REFRESH_TTL_DAYS` | No (`7`)    | Validez deslizante de la sesión                               |
| `web`    | `API_INTERNAL_URL` | Sí          | Destino del proxy `/api` (`http://api:3000` en Compose)       |

Referencia completa: [`env-vars.md`](specs/001-plataforma-base/contracts/env-vars.md).

### Diagramas y espacio de trabajo (feature 003)

Desde un proyecto, _Diagramas_ lista sus diagramas con miniatura; el Administrador sube un PNG, JPG o SVG de hasta 10 MB, marca sus
actividades arrastrando sobre la imagen (nombre, tipo y transiciones, con guardado automático) y
publica la versión. Todos los miembros navegan el diagrama publicado en un canvas three.js: zoom
con la rueda o `+`/`-`, `0` para ajustar, minimapa, selección por clic o con el teclado (`Tab` +
`Enter`). En pantallas de menos de 768 px y en proyectos cerrados, solo lectura. Ver el
[quickstart de la 003](specs/003-diagramas-canvas/quickstart.md) y el
[ADR 0005](docs/adr/0005-imagenes-y-canvas.md).

Las imágenes se guardan en un bucket S3: en local, RustFS (servicio `s3` de Compose, que crea el
bucket al arrancar); en Railway, el Bucket de cada entorno. `api` las sirve por el proxy de `web`
con caché del navegador.

| Servicio | Variable                                                               | Obligatoria  | Uso                                                 |
| -------- | ---------------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| `api`    | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Sí           | Bucket de las imágenes (en Railway, referencias)    |
| `api`    | `S3_REGION`                                                            | No (`auto`)  | Región S3                                           |
| `api`    | `S3_FORCE_PATH_STYLE`, `S3_CREATE_BUCKET`                              | No (`false`) | `true` solo con RustFS (local y CI)                 |
| `web`    | `E2E_HOOKS`                                                            | No           | `true` solo en Compose y CI: expone `__canvasState` |

### Detalles de requisitos (feature 004)

Al seleccionar una actividad del diagrama se abre el panel _Requisitos_: sus requisitos Dado /
Cuando / Entonces, con tipo, prioridad MoSCoW, rol y etiquetas, filtrables y ordenados por votos o fecha, y el formulario de alta si el proyecto
está abierto. Su autor los edita (con historial y aviso si otra persona los cambió a la vez);
los miembros votan y comentan; el Administrador los valida, los marca como duplicados o los
descarta con un motivo, y reasigna los que quedan sin actividad al publicar una versión nueva
(_Requisitos sin actividad_, en la lista de diagramas). En el canvas, cada actividad muestra su
número de requisitos o la marca «Sin detalles», sus notas y un mapa de calor. Ver el
[quickstart de la 004](specs/004-detalles-requisitos/quickstart.md) y el
[ADR 0006](docs/adr/0006-detalles-de-requisitos.md).

### Colaboración en tiempo real (feature 005)

El espacio de trabajo se conecta por WebSocket (Socket.IO, a través de `/socket.io` en el proxy de `web`):

- Los requisitos, votos, comentarios y publicaciones de otras personas aparecen sin recargar.
- La barra _Conectados_ muestra quién está en el diagrama, y cada actividad seleccionada por
  otra persona lleva su indicador de color.
- Los cursores de los demás se mueven sobre el diagrama con su nombre, en el mismo punto de la
  imagen aunque cada uno tenga su zoom; _Ocultar cursores_ los oculta y el navegador lo recuerda.
- Sin conexión aparece «Sin conexión: reintentando…», guardar, votar y comentar se deshabilitan
  y lo que se está escribiendo se conserva como borrador; al volver, se resincroniza solo.
- Quien es retirado del proyecto, o lo pierde porque se borra, vuelve a _Mis proyectos_ con un
  aviso; si el proyecto se cierra, pasa a solo lectura al momento.

Varias réplicas de `api` se reparten los eventos con el adaptador de Redis. Ver el
[quickstart de la 005](specs/005-colaboracion-tiempo-real/quickstart.md) y el
[ADR 0007](docs/adr/0007-colaboracion-en-tiempo-real.md).

### Detección asistida (feature 006)

En un diagrama en borrador, el Administrador pulsa _Detectar actividades_ y el sistema propone
las zonas (acciones, decisiones, inicio y fin), el nombre de cada una y las flechas entre ellas:

- `api` encola la detección en BullMQ y `analytics-worker` la procesa con OpenCV y Tesseract;
  el progreso llega por el socket de la 005 (o consultando cada 3 s sin conexión).
- Las propuestas aparecen punteadas sobre el diagrama con su confianza. Nada se convierte en
  actividad sin revisión: se aceptan (corrigiendo nombre o tipo si hace falta), se descartan o
  se aceptan en bloque las de confianza alta, salvo los posibles duplicados.
- Una flecha se acepta cuando sus dos actividades ya están aceptadas.
- No se publica mientras queden propuestas pendientes.

Flags: `detection` activa la función (Compose la activa) y `detection-llm` añade un
refinamiento opcional con Claude, que solo se usa con `ANTHROPIC_API_KEY` (tiene coste; modelo
configurable con `DETECTION_LLM_MODEL`). `pnpm dev:up` incluye `analytics-worker`.

Para evaluar la precisión con el conjunto de validación (se genera, no se versiona):

```bash
cd apps/analytics
uv run python tests/fixtures/generate.py
uv run python tests/eval/evaluate_detection.py --timing   # zonas, nombres y flechas por subconjunto
```

El CI falla si en los diagramas digitales las zonas bajan del 85 % o los nombres del 80 %. Ver
el [quickstart de la 006](specs/006-deteccion-asistida/quickstart.md) y el
[ADR 0008](docs/adr/0008-deteccion-asistida.md).

### Dashboard analítico (feature 007)

El Administrador de un proyecto abre _Dashboard_ desde los ajustes del proyecto
(`/proyectos/:id/dashboard`). Tiene dos capas:

- **Descriptiva** (inmediata, la calcula `api` sobre MongoDB): KPIs, distribuciones por
  actividad, tipo, prioridad, rol y estado, línea de tiempo y mapa de cobertura, con filtros por
  diagrama, fechas, tipo y estado.
- **Analítica** (en segundo plano): _Ejecutar análisis_ encola un trabajo en BullMQ que procesa
  `analysis-worker` (Python: spaCy, sentence-transformers, UMAP + HDBSCAN, pysentimiento,
  Apriori). El worker no accede a MongoDB: lee la entrada y deja los resultados en el bucket con
  URLs prefirmadas. Calcula palabras clave, términos relacionados, temas, grupos, calidad de la
  redacción, posibles duplicados, sentimiento, patrones y actividades críticas. Si una técnica
  falla, el resto del análisis se conserva; con menos de 20 detalles solo se calcula lo que no
  necesita volumen.
- Nada se cambia sin revisión: un par de duplicados se confirma (aplica la moderación de la 004)
  o se rechaza, y un hallazgo se puede marcar como no útil para que no se repita.
- El análisis automático (cada noche, solo si hubo cambios) está desactivado por defecto y se
  activa por proyecto en el propio dashboard.

Flags: `dashboard` activa la función (Compose la activa) e `insights` añade el resumen de
hallazgos con Claude, que solo se genera con `ANTHROPIC_API_KEY` en `analysis-worker` (tiene
coste; modelo configurable con `INSIGHTS_LLM_MODEL`). Cada hallazgo cita sus evidencias y sus
cifras se verifican contra los datos antes de mostrarlo.

`pnpm dev:up` no incluye `analysis-worker` (su imagen ocupa ~3 GB por los modelos); se levanta
con el perfil `mining`:

```bash
pnpm dev:up:mining                                  # el stack más analysis-worker
pnpm --filter @reqcanvas/api seed:analytics         # proyecto «Tienda demo» con 80 detalles
```

Los gates de calidad del análisis (temas, duplicados y términos ambiguos sobre un conjunto de
validación sintético) corren en el job `analysis-eval` del CI:

```bash
uv run --directory apps/analytics --group mining pytest tests/mining tests/unit/test_mining_run.py
```

Ver el [quickstart de la 007](specs/007-dashboard-analitico/quickstart.md) y el
[ADR 0009](docs/adr/0009-dashboard-analitico.md).

Cada petición lleva un `x-request-id` que aparece en los logs JSON de todos los servicios:

```bash
curl -s -H "x-request-id: prueba-456" localhost:3000/health/deep > /dev/null
docker compose -f infra/docker-compose.yml logs api analytics | grep prueba-456
```

## Desarrollo

| Comando                                                                       | Qué hace                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint`                                                                   | ESLint + Ruff (Python)                                                    |
| `pnpm format:check` / `pnpm format`                                           | Prettier                                                                  |
| `pnpm typecheck`                                                              | TypeScript (todos los paquetes y `e2e/`) + mypy                           |
| `pnpm test:services:up` / `test:services:down`                                | MongoDB, Redis y S3 (RustFS) para las pruebas de integración              |
| `pnpm test`                                                                   | Vitest (shared, api, web) + pytest (analytics)                            |
| `pnpm test:py`                                                                | Solo pytest de `analytics` (unitarias, contrato y gate de precisión)      |
| `pnpm e2e`                                                                    | Pruebas de humo contra `BASE_URL` / `API_URL` y, en local, los flujos E2E |
| `pnpm e2e:perf`                                                               | Mediciones de rendimiento del canvas, la detección y el dashboard (local) |
| `pnpm --filter @reqcanvas/api migrate:up` / `migrate:down` / `migrate:status` | Migraciones (lee `MONGO_URL` y `MONGO_DB`)                                |
| `pnpm --filter @reqcanvas/api migrate:create <nombre>`                        | Nueva migración a partir de `migrations/sample-migration.js`              |

Las pruebas de integración necesitan MongoDB, Redis y un S3 (respaldos de migraciones e imágenes
de diagramas).
El stack de `pnpm dev:up` no los publica en el host; levántalos con:

```bash
pnpm test:services:up      # infra/docker-compose.test.yml: :27017, :6379 y :9000
pnpm test
pnpm test:services:down
```

Para usar otros, define `MONGO_TEST_URL`, `REDIS_TEST_URL` y `S3_TEST_URL`. Antes de la primera
ejecución de `pnpm e2e`, instala el navegador: `pnpm exec playwright install chromium`.

Para ejecutar un servicio fuera de Docker, copia `.env.example` a `.env` y usa
`pnpm --filter @reqcanvas/api dev`.

### Convenciones

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) con alcance
  (`feat(api): …`), validados por commitlint en el hook `commit-msg`. Cada commit es atómico
  y pasa las pruebas por sí solo; una prueba y su implementación van en el mismo commit.
- **Feature flags**: ver [`docs/feature-flags.md`](docs/feature-flags.md).
- **Migraciones**: siempre con `up` y `down`; las destructivas se declaran con
  `destructive: true` ([data model](specs/001-plataforma-base/data-model.md)).
