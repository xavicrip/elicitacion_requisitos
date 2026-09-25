# ADR 0001: Monorepo y stack tecnológico

- **Estado**: aceptado
- **Fecha**: 2026-09-25
- **Feature**: 001-plataforma-base (research R1–R3, R13; constitución v1.1.0)

## Contexto

ReqCanvas tiene tres componentes desplegables (frontend con three.js, API y servicio
analítico en Python) que comparten contratos. La constitución exige servicios desacoplados
con contratos compartidos (Principio II) y commits atómicos que pasen las pruebas (IV).

## Decisión

| Aspecto     | Elección                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositorio | Monorepo con **pnpm workspaces** (`apps/web`, `apps/api`, `packages/shared`); `apps/analytics` es un proyecto Python independiente gestionado con **uv** |
| Runtime JS  | **Node.js 24 LTS** (`.nvmrc`, `engines: ">=24 <25"`, imágenes `node:24-alpine`)                                                                          |
| API         | **Fastify 5** + Mongoose + zod; logs pino con `x-request-id`                                                                                             |
| Contratos   | `packages/shared` exporta **TypeScript fuente** (esquemas zod); `api` lo empaqueta con **tsup** y `web` con Vite                                         |
| Frontend    | React + Vite + **three.js** vía `@react-three/fiber`, servido por **Caddy** con `/config.js` generado al arrancar                                        |
| Analítica   | Python 3.12 + FastAPI + pydantic-settings; `pymongo` (`AsyncMongoClient`) y `redis.asyncio`                                                              |
| Calidad     | ESLint (flat config), Prettier, Ruff, mypy estricto, Vitest, pytest, Playwright; Husky + lint-staged + commitlint                                        |

Sin orquestador de monorepo (Turborepo/Nx): con tres apps no compensa (YAGNI, Principio VII).
Se reconsiderará si el CI supera los 15 minutos (SC-002).

## Desviaciones respecto al plan, descubiertas al implementar

1. **TypeScript 5.9, no 7**: pnpm instala por defecto TypeScript 7 (el port nativo), pero
   `typescript-eslint` todavía depende de la API de TS 5. Se fija `~5.9`.
2. **PyMongo en vez de Motor**: Motor está deprecado en favor del cliente asíncrono nativo de
   PyMongo (`AsyncMongoClient`).
3. **Lock propio para las migraciones**: el lock de migrate-mongo 14 lanza `createIndex` sin
   esperar y deja promesas rechazadas al cerrar el cliente, lo que podía romper el
   `preDeployCommand`. `apps/api/src/db/migrations.ts` implementa un lock de un documento con
   TTL, y el CLI propio (`src/db/cli.ts` → `dist/migrate.js`) sustituye a la CLI de
   migrate-mongo para `up`, `down` y `status`.
4. **Socket de escucha dual en analytics**: asyncio activa `IPV6_V6ONLY` al escuchar en `::`,
   así que uvicorn no respondía por IPv4 (p. ej., el mapeo de puertos de Docker). `analytics`
   crea el socket con `IPV6_V6ONLY=0`, igual que Node en `::`.
5. **Commits de prueba + implementación juntos**: separar la prueba (en rojo) y la
   implementación en commits distintos dejaría commits que no pasan las pruebas, contra el
   Principio IV. El rojo se verifica localmente y ambos van en el mismo commit.

## Consecuencias

- Los tipos de la API y del frontend no pueden divergir: ambos importan los mismos esquemas.
- Cada imagen se construye desde la raíz del repositorio (contexto común del workspace).
- Los servicios Python y Node comparten convenciones (JSON logs, `request_id`, `/health`)
  pero no código.
