---
description: "Task list for feature 007-dashboard-analitico"
---

# Tasks: Dashboard analítico con minería de datos y de texto

**Input**: Design documents from `/specs/007-dashboard-analitico/`
**Prerequisites**: plan.md (incluidos los "Ajustes tras implementar la 002–006"), spec.md,
research.md, data-model.md, contracts/analysis-job.md, contracts/analysis-results.schema.json,
contracts/dashboard.openapi.yaml, quickstart.md

**Tests**: OBLIGATORIAS (Principio III). Cada par prueba + implementación va en el mismo commit.
Las pruebas de `api` usan MongoDB, Redis y RustFS reales (`pnpm test:services:up`) y un **worker
falso en Node** que consume la cola `analysis`, descarga la entrada por la URL firmada y sube un
`AnalysisResults` fijo (como el de la 006, `tests/helpers/detection-worker.ts`); los tiempos
(timeout del job, latido del worker, intervalo de consulta) se inyectan por opciones. Las de
`analytics` usan pytest con el conjunto de validación generado; las técnicas con modelos
(embeddings, temas, sentimiento) se ejecutan en el job `analysis-eval` del CI con la imagen
`mining`, y en `test-python` con dobles ligeros; la cobertura de `analytics` combina los dos jobs
(plan, ajuste 16). El LLM siempre es un cliente simulado. Los E2E
siguen el patrón de la 006 (`e2e/flows/`) contra Compose con el worker real.

**Commits**: Conventional Commits, un commit atómico por tarea o par; el tipo y alcance
sugeridos van al final de cada tarea.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario (US1–US5)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: decisión de arquitectura, dependencias, documentos al día con los ajustes del plan,
conjunto de validación y datos de ejemplo

- [X] T001 ADR `docs/adr/0009-dashboard-analitico.md` antes de introducir las tecnologías nuevas (restricciones de la constitución): capa descriptiva en `api` con agregaciones de MongoDB y analítica en Python; spaCy, sentence-transformers, BERTopic con el `HDBSCAN` de scikit-learn, pysentimiento, mlxtend y networkx; el worker no accede a MongoDB (entrada y resultados por el bucket con URLs firmadas); servicio `analysis-worker` aparte con la imagen `mining`; insights con Claude y evidencias verificadas; ECharts en `web` (plan, ajustes 1, 3, 4 y 6) — `docs(adr)`
- [X] T002 Dependencias: en `apps/analytics/pyproject.toml` un grupo `mining` (con `uv add --group mining`) con `spacy`, el modelo `es_core_news_md` (rueda fijada por URL), `sentence-transformers`, `torch` CPU (índice `https://download.pytorch.org/whl/cpu`), `bertopic`, `umap-learn`, `scikit-learn` ≥ 1.3, `pysentimiento`, `mlxtend` y `networkx`; `apps/analytics/Dockerfile.mining` que instala ese grupo y descarga en el build `paraphrase-multilingual-MiniLM-L12-v2` y el modelo de sentimiento (sin descargas en tiempo de ejecución); en `apps/web/package.json`, `echarts`, `echarts-for-react` y `echarts-wordcloud` (plan, ajustes 3 y 4); añadir `Dockerfile.mining` a la matriz del job `build` de `.github/workflows/ci.yml` — `chore(repo)`
- [X] T003 [P] Alinear `research.md` (R4: `HDBSCAN` de scikit-learn y sin caché `analysis_embeddings`; R10: `INSIGHTS_LLM_MODEL`, por defecto `claude-opus-5-5`, `beta.messages.parse`, `fallbacks` y 60 s; R11: consulta cada 3 s en lugar de eventos; R12: guía *dataviz*), `data-model.md` (`analysis_runs` solo de `api`, estados `pending|running|done|failed` con `partial`, con `inputKey`/`resultsKey` en el bucket y sin campos del worker; sin `analysis_embeddings`; cascada al borrar el proyecto), `contracts/analysis-job.md` (URLs firmadas de entrada y de resultados, valor de retorno con `status`, `stages` y `detailCount`, latido `analysis:worker:{id}`), `contracts/dashboard.openapi.yaml` (rutas tras el flag `dashboard`), `quickstart.md` (flags `dashboard` e `insights`, servicio `analysis-worker`, comandos reales) y el propio `plan.md` (Technical Context y árbol de archivos: `jobs/analysis.ts`, `mining/worker.py`, `railway.mining.json`) con los ajustes 1–16 del plan — `docs(specs)`
- [X] T004 [P] Generador reproducible del conjunto de validación en `apps/analytics/tests/fixtures/generate_details.py` (semilla fija): 300 detalles Dado/Cuando/Entonces en español sobre 10 actividades con 3 temas conocidos (pagos, notificaciones, seguridad) y ruido, 30 pares de casi duplicados redactados de forma distinta, 40 detalles con términos ambiguos del léxico, etiquetas, tipos, prioridades, votos y estados, 2 actividades calientes y 2 frías etiquetadas, detalles con sentimiento negativo y una regla de asociación conocida (`tag:pagos` → `type:non_functional`); *ground truth* en `apps/analytics/tests/fixtures/details/validation.json` (versionado) con el formato de entrada del contrato — `test(analytics)`
- [X] T005 [P] Datos de ejemplo para `api` y E2E: `apps/api/scripts/seed-analytics.ts` (`pnpm --filter @reqcanvas/api seed:analytics`, con `--print-expected`) crea el proyecto "Tienda demo" con un diagrama publicado de 10 actividades, 80 detalles de 6 participantes (3 temas, 5 ambiguos, 3 pares de duplicados) a partir de un subconjunto del conjunto de validación; helpers de E2E en `e2e/flows/dashboard.ts` que siembran el proyecto por la API y esperan a que un análisis termine — `test(e2e)`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contrato del job en ambos lados, flags, URL firmada de escritura, colecciones, cola
en `api` y esqueleto del worker de minería

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase

- [X] T006 [P] Pruebas de `packages/shared/src/analytics.ts` en `packages/shared/tests/analytics.test.ts`: `DashboardFilters` (`diagramIds`, `from`, `to`, `types`, `statuses`, por defecto `pending` y `validated`), `DescriptiveDashboard`, `AnalysisJobInput` v1 (URLs de entrada y de resultados, `stages`, `settings`), `AnalysisJobReturn` (`status` ∈ done, failed, con `partial`; `stages` con `status` ∈ done, failed, skipped y `reason`), `AnalysisRunStatus` (`pending`, `running`, `done`, `failed`, constitución VI) con `partial` y `AnalysisResults` con `schemaVersion: 1` (cada sección opcional); los ejemplos JSON de `apps/analytics/tests/contract/examples/analysis/*.json` validan — `test(shared)`
- [X] T007 Implementar `packages/shared/src/analytics.ts` (esquemas zod espejo de `analysis-results.schema.json`) y exportarlo desde `packages/shared/src/index.ts`; crear los ejemplos de contrato (entrada, retorno completo, parcial y con datos insuficientes, resultados de ejemplo) — `feat(shared)`
- [X] T008 [P] Prueba de contrato del lado Python en `apps/analytics/tests/contract/test_analysis_job.py`: los mismos ejemplos validan contra los modelos pydantic, uno inválido (`v` distinto de 1, `schemaVersion` desconocido, etapa inexistente) se rechaza y la serialización ida y vuelta coincide — `test(analytics)`
- [X] T009 Implementar `apps/analytics/src/analytics/mining/schemas.py` (pydantic, espejo del contrato v1; sin dependencias del grupo `mining` para que `test-python` lo importe) — `feat(analytics)`
- [X] T010 [P] Pruebas de los flags en `apps/api/tests/integration/dashboard-flag.test.ts`: `dashboard` e `insights` desactivados por defecto y de la 007; sin `dashboard`, `/projects/:id/dashboard/*`, `/projects/:id/analysis-runs`, `/analysis-runs/*`, `/projects/:id/duplicate-decisions` y `/projects/:id/analysis-settings` responden `404` (`GATED_PREFIXES`) y las rutas parecidas de la 004 no se ven afectadas; `GET /config` los informa — `test(api)`
- [X] T011 Implementar los flags en `packages/shared/src/flags.ts`, los prefijos en `GATED_PREFIXES` de `apps/api/src/plugins/flags.ts` y `docs/feature-flags.md`; `FEATURE_FLAGS` por defecto `dashboard=true` en `infra/docker-compose.yml` y en el job `e2e-smoke` de `.github/workflows/ci.yml` (plan, ajuste 5) — `feat(shared)`
- [X] T012 [P] Prueba de `presignPut` en `apps/api/tests/integration/storage-presign.test.ts` (RustFS real): la URL sube un objeto sin credenciales con el `content-type` fijado, caduca tras el TTL inyectado y no permite leer ni escribir otra clave — `test(api)`
- [X] T013 Implementar `presignPut(key, contentType, ttlSeconds)` en `apps/api/src/lib/storage.ts` (plan, ajuste 1) — `feat(api)`
- [X] T014 [P] Prueba de la migración en `apps/api/tests/integration/analysis-migration.test.ts` (con `{ timeout: 30_000 }`, como las demás): `20261029000000-analysis-indexes.js` crea `{projectId, createdAt: -1}` y el índice único parcial de runs `pending|running` por proyecto en `analysis_runs`, el único `{projectId, pair}` de `duplicate_decisions`, `{projectId, runId}` de `insight_feedback` y el único `{projectId}` de `analysis_settings`; `down` los elimina y conserva los datos; `up → down → up` es consistente — `test(api)`
- [X] T015 Implementar la migración y los modelos `apps/api/src/modules/dashboard/models/{analysis-run,duplicate-decision,insight-feedback,analysis-settings}.ts`, y la cascada al borrar un proyecto (`registerCascade`, como `modules/diagrams/cascade.ts`; los archivos del bucket ya caen con `deletePrefix(projects/{id})`) — `feat(api)`
- [X] T016 [P] Pruebas del worker de minería en `apps/analytics/tests/unit/test_mining_worker.py` con un procesador falso y un servidor HTTP local que hace de bucket: consume la cola `analysis` con el prefijo configurado, descarga y descomprime la entrada, informa el progreso por etapa, sube `results.json.gz` y devuelve el resumen; una etapa que falla deja las demás y el retorno `partial: true`; el `requestId` del job aparece en los logs; un job con `v` desconocido o una descarga fallida termina `failed` con un código; latido `analysis:worker:{id}` y `GET /health` como el worker de la 006 — `test(analytics)`
- [X] T017 En dos commits: primero `refactor(analytics)`, extraer a `apps/analytics/src/analytics/queue_worker.py` lo común con `analytics/worker.py` (conexión, latido, salud y cierre ordenado) con las pruebas de la 006 en verde; después implementar `apps/analytics/src/analytics/mining/worker.py`, el servicio `analysis-worker` en el perfil `mining` de `infra/docker-compose.yml` (`Dockerfile.mining`, `ANALYSIS_TIMEOUT_S=900`) con su healthcheck, y el job `analysis-eval` en `.github/workflows/ci.yml` (construye `Dockerfile.mining` con caché de GitHub Actions y ejecuta `tests/eval` con cobertura) (plan, ajuste 16) — `feat(analytics)`
- [X] T018 [P] Pruebas de la cola en `apps/api/tests/integration/analysis-queue.test.ts` con el worker falso: crear un run exporta la entrada al bucket (detalles filtrados **sin autor**, con los filtros del run, nombres de actividad de la versión publicada, duplicados confirmados contados una vez, decisiones previas) y encola con las dos URLs; al completar, `api` descarga y valida los resultados y el run pasa a `done` (con `partial` si alguna etapa falló) con `detailCount` y `stages`; un resultado inválido o el timeout lo dejan `failed` con un mensaje en español; un segundo run activo en el proyecto → `409 ANALYSIS_IN_PROGRESS`; se conservan los 10 últimos runs (los anteriores y sus archivos se borran); `/health/deep` incluye `analysis-worker` con el flag activo — `test(api)`
- [X] T019 Implementar `apps/api/src/jobs/analysis.ts` (patrón de `jobs/detection.ts`), `apps/api/src/modules/dashboard/analysis.service.ts` (crear run, exportar entrada, procesar el retorno, retención) y el check de `/health/deep` en `apps/api/src/routes/health.ts` (plan, ajustes 1 y 2) — `feat(api)`

**Checkpoint**: contrato, flags, bucket, colecciones, cola y worker listos

---

## Phase 3: User Story 1 - Visión general del levantamiento (Priority: P1) 🎯 MVP

**Goal**: el Administrador ve KPIs, distribuciones, serie temporal y mapa de cobertura, con
filtros, calculados al momento en `api`

**Independent Test**: con "Tienda demo" (`seed:analytics`), cada indicador coincide con
`--print-expected`; un Participante no puede abrir el dashboard

### Tests for User Story 1 ⚠️

- [X] T020 [P] [US1] Pruebas de integración en `apps/api/tests/integration/dashboard-descriptive.test.ts`: total de detalles, participantes activos, % de actividades cubiertas, distribuciones por actividad, tipo, prioridad, `authorRole` y estado, y serie temporal diaria (zona horaria del proyecto) coinciden con los valores calculados a mano sobre la semilla, con *participante activo* según el plan (ajuste 14); los filtros de diagrama, fechas, tipo y estado recalculan todo; `discarded` excluidos por defecto y duplicados contados una vez; Participante → `403`; proyecto inexistente → `404` — `test(api)`
- [X] T021 [P] [US1] Prueba de contrato en `apps/api/tests/contract/dashboard.contract.test.ts`: `GET /projects/{id}/dashboard/descriptive` cumple `DescriptiveDashboard` (estricto) y la cobertura por actividad reutiliza la forma de la 004; las historias siguientes añaden aquí la prueba de contrato de cada ruta suya de `dashboard.openapi.yaml` (constitución III) — `test(api)`
- [X] T022 [P] [US1] Pruebas de `web` en `apps/web/tests/dashboard-descriptive.test.tsx`: la página muestra los KPIs y los gráficos (cada uno con texto alternativo y tabla accesible), los filtros cambian la consulta, un detalle con `<img src=x onerror=…>` se muestra como texto en los tooltips, el mapa de cobertura al hacer clic muestra los indicadores de la actividad y el enlace a sus requisitos, el enlace *Dashboard* solo aparece al Administrador con el flag, y un Participante ve el acceso denegado — `test(web)`
- [X] T023 [P] [US1] E2E en `e2e/flows/dashboard-descriptive.spec.ts`: sembrar "Tienda demo", abrir el dashboard, comprobar los KPIs esperados, filtrar por *No funcional* y por fechas, hacer clic en una actividad del mapa; el Participante recibe el acceso denegado — `test(e2e)`

### Implementation for User Story 1

- [X] T024 [US1] Implementar `apps/api/src/modules/dashboard/descriptive.service.ts` (pipelines de agregación con los índices existentes de `details`; cobertura con `coverageOf` de la 004) y `apps/api/src/modules/dashboard/descriptive.routes.ts` (`GET /projects/:id/dashboard/descriptive`, solo Administrador) (plan, ajuste 7) — `feat(api)`
- [X] T025 [US1] Implementar en `web` la ruta `/proyectos/:id/dashboard` y el enlace en la cabecera del proyecto (Administrador y flag `dashboard`), `apps/web/src/features/dashboard/{DashboardPage,FiltersBar}.tsx` y `descriptive/{KpiTiles,Distributions,Timeline,CoverageMap}.tsx` con ECharts según la guía *dataviz* (paleta validada en claro y oscuro, tabla accesible por gráfico, formateador que escapa el texto de los tooltips, plan ajuste 15); `CoverageMap` dibuja la imagen del diagrama con una zona pulsable por actividad y la escala del mapa de calor de la 004 (plan, ajuste 10); ECharts se carga de forma diferida con la ruta — `feat(web)`

**Checkpoint**: US1 funcional y demostrable sin el worker

---

## Phase 4: User Story 2 - Análisis del texto de los requisitos (Priority: P1)

**Goal**: el análisis en segundo plano produce palabras clave por actividad, nube, red de
coocurrencia, temas y grupos, con progreso y fecha

**Independent Test**: con el conjunto de validación, los 3 temas conocidos salen como temas
distintos; con menos de 20 detalles, el sistema avisa y solo muestra lo descriptivo

### Tests for User Story 2 ⚠️

- [X] T026 [P] [US2] Pruebas de `apps/analytics/tests/mining/test_preprocess.py`: lemas de spaCy, palabras vacías propias y del proyecto (`extraStopwords`), n-gramas 1–3 sobre lemas, componentes Dado/Cuando/Entonces por separado y porcentaje de texto no reconocido (detalles en otro idioma) — `test(analytics)`
- [X] T027 [P] [US2] Pruebas de `apps/analytics/tests/mining/test_keywords.py`: c-TF-IDF da a cada actividad sus términos distintivos (top 15), la nube usa la frecuencia global (top 100) y la red de coocurrencia conserva pares con PMI > 0 y frecuencia ≥ 3 (top 150 aristas, comunidades) — `test(analytics)`
- [X] T028 [P] [US2] Pruebas de `apps/analytics/tests/mining/test_topics.py` (job `analysis-eval`): sobre el conjunto de validación, la cadena UMAP + HDBSCAN + c-TF-IDF separa los 3 temas conocidos (pureza ≥ 0,8), los grupos HDBSCAN tienen ≥ 3 detalles y la proyección 2D tiene un punto por detalle; con menos de 20 detalles, `topics` y `clusters` quedan `skipped` con `INSUFFICIENT_DATA` — `test(analytics)`
- [X] T029 [P] [US2] Pruebas de integración en `apps/api/tests/integration/analysis-runs.test.ts` y de contrato de esas rutas en `apps/api/tests/contract/dashboard.contract.test.ts`: `POST /projects/:id/analysis-runs` (con o sin filtros) → `202` con el run `pending` y sus filtros; `GET /analysis-runs/:id` con progreso por etapa; `GET /projects/:id/analysis-runs/latest` con los resultados y la obsolescencia (`newDetails` cuando hay detalles creados o editados después del run, FR-014); historial (como mucho los 10 runs que se conservan); Participante → `403` — `test(api)`
- [X] T030 [P] [US2] Pruebas de `web` en `apps/web/tests/dashboard-text.test.tsx`: *Ejecutar análisis* lanza el run y consulta cada 3 s hasta terminar (sin consultas al terminar), progreso por etapa, fecha del análisis, pestañas de palabras clave, nube, coocurrencia, temas y grupos (clic en un grupo → sus detalles con enlace), aviso de datos insuficientes, porcentaje de texto no reconocido, filtros con los que se calculó, texto escapado en tooltips y banner "Análisis desactualizado: N detalles nuevos" — `test(web)`
- [X] T031 [P] [US2] E2E en `e2e/flows/dashboard-analysis.spec.ts` con el worker real: ejecutar el análisis de "Tienda demo", ver el progreso, los 3 temas y las palabras clave de una actividad; crear un detalle nuevo → banner de desactualizado (US3 y US5 añaden a este E2E la confirmación de un duplicado y el aviso de resumen no disponible). Necesita `analysis-worker` (perfil `mining`); en el CI corre en el job `e2e-smoke`, que lo levanta (plan, ajuste 16) — `test(e2e)`

### Implementation for User Story 2

- [X] T032 [US2] Implementar `apps/analytics/src/analytics/mining/{loader,preprocess,keywords,cooccurrence}.py` — `feat(analytics)`
- [X] T033 [US2] Implementar `apps/analytics/src/analytics/mining/{embeddings,topics,clusters}.py` y el orquestador `apps/analytics/src/analytics/mining/run.py` (etapas con progreso, fallos parciales, umbral de 20 detalles, duración por etapa en los logs) — `feat(analytics)`
- [X] T034 [US2] Implementar `apps/api/src/modules/dashboard/analysis.routes.ts` (crear, consultar, último, lista) con la obsolescencia por `dataFingerprint` — `feat(api)`
- [X] T035 [US2] Implementar en `web` el control del análisis (`useAnalysisRun` con consulta cada 3 s, filtros al lanzar), `StaleBanner.tsx` y `text/{Keywords,WordCloud,CooccurrenceGraph,Topics,Clusters}.tsx` (plan, ajustes 8, 14 y 15) — `feat(web)`

**Checkpoint**: US1 y US2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Calidad y duplicados (Priority: P2)

**Goal**: puntaje de calidad explicado por detalle y pares de casi duplicados que el
Administrador confirma o rechaza

**Independent Test**: en el conjunto de validación se detectan ≥ 80 % de los ambiguos y ≥ 80 %
de los duplicados con < 20 % de falsos positivos; confirmar un par marca el detalle como
duplicado (004) y rechazarlo evita que vuelva a proponerse

### Tests for User Story 3 ⚠️

- [X] T036 [P] [US3] Pruebas de `apps/analytics/tests/mining/test_quality.py`: cada penalización de R7 con su explicación (término ambiguo del léxico y de `extraAmbiguousTerms` con la sugerencia "hazlo medible", Entonces sin verbo observable o sin cifra en No funcional, componentes cortos, Cuando sin verbo, pronombres sin antecedente) y el puntaje 0–100 — `test(analytics)`
- [X] T037 [P] [US3] Pruebas de `apps/analytics/tests/mining/test_duplicates.py`: umbrales 0,85 en la misma actividad y 0,92 entre actividades, cada parte (Dado, Cuando, Entonces) ≥ 0,80, pares con una decisión previa excluidos, detalles ya `duplicate` fuera — `test(analytics)`
- [X] T038 [P] [US3] Gates en `apps/analytics/tests/mining/test_quality_gates.py` (job `analysis-eval` de T017): duplicados recall ≥ 0,80 y falsos positivos < 0,20 (SC-003), ambiguos recall ≥ 0,80 (SC-004), pureza de temas ≥ 0,8 — `test(analytics)`
- [X] T039 [P] [US3] Pruebas de integración en `apps/api/tests/integration/duplicate-decisions.test.ts` y de contrato de esas rutas en `apps/api/tests/contract/dashboard.contract.test.ts`: confirmar un par aplica la moderación de la 004 (`status: duplicate`, `duplicateOf`) y registra la decisión; rechazarlo la registra y el siguiente export la incluye; decidir dos veces o con el proyecto cerrado → `409`; Participante → `403`; `GET/PUT /projects/:id/analysis-settings` valida los términos (≤ 100 ambiguos, ≤ 200 palabras vacías) — `test(api)`
- [X] T040 [P] [US3] Pruebas de `web` en `apps/web/tests/dashboard-quality.test.tsx`: lista de calidad ordenable por puntaje con el término resaltado, la explicación y el enlace al detalle; pares de duplicados con su porcentaje, *Confirmar* y *Rechazar* (el par desaparece) — `test(web)`

### Implementation for User Story 3

- [X] T041 [US3] Implementar `apps/analytics/src/analytics/mining/{quality,duplicates}.py` y `apps/analytics/src/analytics/mining/lexicon/ambiguous_es.txt` — `feat(analytics)`
- [X] T042 [US3] Implementar en `api` `POST /projects/:id/duplicate-decisions` (reutiliza el servicio de moderación de `modules/details`) y `GET/PUT /projects/:id/analysis-settings` — `feat(api)`
- [X] T043 [US3] Implementar en `web` `quality/{QualityList,DuplicatePairs}.tsx` y la edición de los términos del proyecto — `feat(web)`

---

## Phase 6: User Story 4 - Patrones, sentimiento y actividades críticas (Priority: P2)

**Goal**: sentimiento por actividad, reglas de asociación explicadas y actividades calientes y
frías con su motivo

**Independent Test**: en el conjunto de validación, las actividades preparadas como calientes y
frías se clasifican así, y cada regla tiene soporte, confianza y frase

### Tests for User Story 4 ⚠️

- [X] T044 [P] [US4] Pruebas de `apps/analytics/tests/mining/test_patterns.py`: sentimiento con un clasificador falso (distribución por actividad, solo NEG ≥ 0,7 destacado, top 10), Apriori con soporte ≥ 0,05, confianza ≥ 0,6 y lift > 1,2 (top 30 con frase de plantilla) y calientes/frías por z-score con el motivo dominante; el modelo real se prueba en `analysis-eval` — `test(analytics)`
- [X] T045 [P] [US4] Pruebas de `web` en `apps/web/tests/dashboard-patterns.test.tsx`: distribución de sentimiento por actividad y detalles más negativos, reglas con soporte, confianza y frase, actividades calientes y frías con su motivo — `test(web)`

### Implementation for User Story 4

- [X] T046 [US4] Implementar `apps/analytics/src/analytics/mining/{sentiment,association,hotcold}.py` — `feat(analytics)`
- [X] T047 [US4] Implementar en `web` `patterns/{Sentiment,AssociationRules,HotColdActivities}.tsx` — `feat(web)`

---

## Phase 7: User Story 5 - Insights en lenguaje natural (Priority: P3)

**Goal**: entre 3 y 10 hallazgos y recomendaciones en español, cada uno con evidencias
verificadas y valoración del Administrador

**Independent Test**: con un cliente de Claude simulado, cada insight devuelto enlaza a datos
existentes; sin el servicio, el resto del dashboard funciona

### Tests for User Story 5 ⚠️

- [X] T048 [P] [US5] Pruebas de `apps/analytics/tests/unit/test_insights.py` con un cliente simulado: salida estructurada, se descartan los insights con evidencias inexistentes o con cifras que no cuadran (±2 puntos) con las de las evidencias que citan; si quedan menos de 3 se reintenta una vez con los descartados y, si siguen faltando, se devuelven los que haya con `fewerThanExpected` (plan, ajuste 14); nunca más de 10; los rechazados del proyecto van en las instrucciones, ningún nombre ni email en lo enviado; sin clave, negativa, error o más de 60 s → etapa `skipped` o `failed` y el resto de resultados intactos — `test(analytics)`
- [ ] T049 [P] [US5] Pruebas de integración en `apps/api/tests/integration/insights.test.ts` y de contrato de esas rutas en `apps/api/tests/contract/dashboard.contract.test.ts`: `POST /analysis-runs/:id/insights/:insightId/feedback` guarda la valoración y oculta el insight, y el siguiente job lleva los rechazados en `settings.rejectedInsights`; `POST /analysis-runs/:id/insights/regenerate` encola un job solo con la etapa `insights` y la URL de los resultados anteriores; con `insights` desactivado la etapa no se pide y la regeneración responde `409` con un mensaje — `test(api)`
- [ ] T050 [P] [US5] Pruebas de `web` en `apps/web/tests/dashboard-insights.test.tsx`: lista de insights con título, afirmación y recomendación como texto plano, clic → panel de evidencias con los datos, *No útil* lo oculta, *Regenerar* lanza el job, aviso "El resumen no está disponible" sin afectar al resto — `test(web)`

### Implementation for User Story 5

- [X] T051 [US5] Implementar `apps/analytics/src/analytics/mining/insights.py` (plan, ajuste 6) — `feat(analytics)`
- [ ] T052 [US5] Implementar en `api` la valoración y la regeneración de insights — `feat(api)`
- [ ] T053 [US5] Implementar en `web` `insights/{InsightsPanel,EvidenceDrawer}.tsx` — `feat(web)`

---

## Phase 8: Análisis programado (FR-013, P3)

- [ ] T054 [P] Pruebas en `apps/api/tests/integration/analysis-schedule.test.ts`: un proyecto abierto con la programación activada tiene su scheduler de BullMQ con su cron y zona horaria; al dispararse solo encola si cambió el `dataFingerprint`; desactivarla, cerrar o borrar el proyecto elimina el scheduler (plan, ajuste 9) — `test(api)`
- [ ] T055 Implementar la programación en `apps/api/src/jobs/analysis-schedule.ts` y la opción en los ajustes del dashboard en `web` — `feat(api)`

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T056 [P] Mediciones en `e2e/perf/dashboard.perf.spec.ts` (sin navegador, como la de la 006): dashboard descriptivo con 2 000 detalles en < 3 s (SC-001) y análisis completo de 2 000 detalles en < 5 min (SC-002) y, como referencia del caso límite, 5 000 detalles en < 12 min, con la memoria máxima de `analysis-worker`; anotarlo en `plan.md` — `perf(e2e)`
- [ ] T057 [P] Completar el ADR 0009 con las mediciones de T056 y el resultado de los gates — `docs(adr)`
- [ ] T058 [P] README (sección del dashboard: capas descriptiva y analítica, flags `dashboard` e `insights`, `analysis-worker` en Compose, `seed:analytics` y los gates) y revisar que `quickstart.md` siga al día — `docs(repo)`
- [ ] T059 Desplegar `analysis-worker`: configuración en `apps/analytics/railway.mining.json` (`Dockerfile.mining`, *start command* `python -m analytics.mining.worker`, healthcheck `/health`), añadirlo al bucle de `.github/workflows/deploy.yml` y a `tests/repo/railway-config.test.ts`, y registrarlo en `docs/adr/0002-despliegue-railway.md` — `ci(infra)`
- [ ] T060 Configurar Railway **antes de fusionar**: crear `analysis-worker` en staging y producción con esa configuración y las variables `REDIS_URL`, `ANALYSIS_TIMEOUT_S=900` y `LOG_LEVEL`; `ANTHROPIC_API_KEY` solo si se quieren insights; `FEATURE_FLAGS=dashboard=true` en `api` de staging (producción sin cambios). Si `railway add` solo crea la instancia del entorno enlazado, crear la otra con `environmentPatchCommit` (ADR 0002) — `docs(infra)`
- [ ] T061 Recorrer quickstart.md en staging, comprobar tiempo y memoria de `analysis-worker` en Railway y dejar preparada la evaluación de insights con analistas (SC-005); registrar el resultado en `quickstart.md` — `docs(specs)`
- [ ] T062 Activar `dashboard` por defecto (`default: true`) cuando US1–US5 y T061 estén en verde y retirarlo en un PR posterior (constitución IV); `insights` sigue como flag operativo (coste) con `default: false` — `feat(shared)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → historias.
- **US1**: tras la Phase 2 (en rigor solo necesita T006–T011 y T014–T015: no usa el worker).
- **US2**: tras la Phase 2. Aporta el orquestador `run.py` que usan US3–US5.
- **US3** y **US4**: tras US2 (comparten preprocesamiento, embeddings y orquestador); independientes entre sí.
- **US5**: tras US3 y US4 (resume todos sus resultados).
- **Phase 8**: tras US2.
- **Polish**: al final; T060 antes de fusionar a `main`; T062 es la última tarea.

### Within Each User Story

- Pruebas (en rojo) → implementación (en verde) → refactor; cada par se integra en un commit.
- `analytics` y `api` en paralelo → `web` → E2E en verde.

### Parallel Opportunities

- Phase 1: T001 primero; T003, T004 y T005 en paralelo con T002.
- Phase 2: los pares T006–T007, T010–T011, T012–T013 y T014–T015 son independientes; T008–T009 tras T007; T016–T017 tras T002 y T009 (T017 crea el job `analysis-eval` que usan T028, T031 y T038); T018–T019 tras T007, T013 y T015.
- US1 en paralelo con todo `analytics` de US2 (T026–T028, T032–T033).
- US3 y US4 en paralelo entre sí.

## Parallel Example: User Story 2

```bash
# Pruebas en paralelo (deben fallar):
Task: "Preprocesamiento en apps/analytics/tests/unit/test_preprocess.py"
Task: "Palabras clave en apps/analytics/tests/unit/test_keywords.py"
Task: "Temas en apps/analytics/tests/eval/test_topics.py"
Task: "Runs en apps/api/tests/integration/analysis-runs.test.ts"
Task: "Web en apps/web/tests/dashboard-text.test.tsx"
Task: "E2E en e2e/flows/dashboard-analysis.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 y 2 → 2. US1 → **validar con quickstart §1** (KPIs de "Tienda demo" iguales a
   `--print-expected`, filtros y acceso denegado al Participante).

### Incremental Delivery

US2 → US3 y US4 → US5 → programación, cada una integrable en `main` detrás del flag `dashboard`
y desplegable en staging (con `dashboard=true` solo allí). Producción recibe el código en cada
release, pero la funcionalidad solo se activa con T062.

## Notes

- Tareas totales: 62 (Setup 5, Foundational 14, US1 6, US2 10, US3 8, US4 4, US5 6, programación 2, Polish 7).
- Nunca integrar un commit que rompa `pnpm test` o `pnpm test:py` (Principio IV).
- El worker nunca accede a MongoDB: recibe la entrada y devuelve los resultados por el bucket con URLs firmadas, y `api` los persiste (Principio II).
- Ningún resultado modifica un detalle sin confirmación del Administrador (FR-015, Principio VII): solo confirmar un duplicado aplica la moderación de la 004.
- La imagen `mining` ocupa ~3 GB: vigilar el espacio en disco local antes de construirla.
- Cambios tras `/speckit-analyze`: C1 → plan ajuste 13, T003, T006, T016, T018, T029; C2 → T021, T029, T039, T049; I1 → plan ajuste 3, T002, T017, T059; I2 → T017, T028, T038; S1 → plan ajuste 15, T022, T025, T030, T035; U1 → T004; U2 y L4 → plan ajuste 14, T020; U3 → plan ajuste 14, T048; U4 → plan ajuste 14, T018, T029, T035; U5 → T030; U6 → T056; G1 → T031; G2 y P2 → plan ajuste 16, T017, T031; P1 → T017; L1 → plan ajuste 9; L2 → T016; L3 → T039.
