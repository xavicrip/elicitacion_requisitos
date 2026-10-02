# Implementation Plan: Dashboard analítico con minería de datos y de texto

**Branch**: `007-dashboard-analitico` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-dashboard-analitico/spec.md`

## Summary

El dashboard tiene dos capas:

1. **Descriptiva (US1)**, calculada en `api` con agregaciones de MongoDB en tiempo real: KPIs,
   distribuciones, serie temporal y mapa de cobertura sobre el diagrama (se reutiliza el
   endpoint de cobertura de la 004), todo con filtros.
2. **Analítica (US2–US5)**, calculada de forma asíncrona por un worker Python de `analytics`
   (cola BullMQ `analysis`), que lee los detalles del proyecto (lectura compartida declarada en
   la 004) y ejecuta:
   - preprocesamiento en español con spaCy;
   - palabras clave c-TF-IDF por actividad, nube de palabras y red de coocurrencia (networkx);
   - embeddings multilingües (sentence-transformers) para temas (BERTopic), grupos (HDBSCAN) y
     casi duplicados (similitud coseno);
   - sentimiento (pysentimiento);
   - calidad del requisito (reglas + léxico de ambigüedad configurable);
   - reglas de asociación (mlxtend Apriori);
   - actividades calientes y frías;
   - resumen de **insights** con Claude y salidas estructuradas, en el que cada afirmación
     referencia evidencias verificables.

Los resultados se guardan por ejecución en `analysis_runs` (escritura compartida declarada).
El frontend usa **ECharts**.

## Technical Context

**Language/Version**: Python 3.12 (`analytics`); TypeScript 5.x / Node.js 24 LTS (`api`, `web`)
**Primary Dependencies**: `analytics` (grupo `mining`): `spacy` + `es_core_news_md`, `scikit-learn` (con `HDBSCAN`), `sentence-transformers` (`paraphrase-multilingual-MiniLM-L12-v2`), `torch` CPU, `bertopic`, `umap-learn`, `pysentimiento`, `mlxtend`, `networkx`; ya presentes: `bullmq`, `anthropic`. `web`: `echarts` 5 + `echarts-for-react` + `echarts-wordcloud`
**Storage**: MongoDB, todo propiedad de `api`: `analysis_runs`, `duplicate_decisions`, `insight_feedback`, `analysis_settings`. Bucket: entrada y resultados de cada run bajo `projects/{id}/analysis/` (ajuste 1)
**Testing**: pytest por técnica con el **conjunto de validación etiquetado** (300 detalles sintéticos con temas, duplicados y ambigüedades conocidos) y gates de métricas; Vitest (agregaciones descriptivas contra datos semilla con resultados calculados a mano); Playwright (dashboard y filtros); evaluación manual de insights con analistas (SC-005)
**Target Platform**: servicio `analysis-worker` en Railway (imagen `Dockerfile.mining`, CPU sin GPU; la cuenta admite 24 GB por servicio)
**Project Type**: Aplicación web + servicio analítico
**Performance Goals**: dashboard descriptivo < 3 s con 2 000 detalles (SC-001); análisis completo < 5 min con 2 000 detalles (SC-002)
**Constraints**: modelos incluidos en la imagen (sin descargas en tiempo de ejecución); el análisis no degrada la API (proceso separado, concurrencia 1 por réplica); al LLM no se envían nombres ni emails; los análisis de texto exigen ≥ 20 detalles
**Scale/Scope**: ≤ 5 000 detalles por proyecto; 1 análisis activo por proyecto

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Todas las métricas se calculan por actividad; los insights enlazan a detalles y actividades concretos. | ✅ |
| II. Servicios desacoplados | Contrato de la cola en `contracts/analysis-job.md`; esquema de resultados versionado (`schemaVersion`) validado en ambos lados. El worker no accede a MongoDB: recibe el conjunto y devuelve los resultados por el bucket con URLs firmadas, y solo `api` escribe `analysis_runs` (ajuste 1). | ✅ |
| III. Pruebas primero | Gates de métricas sobre el conjunto de validación (duplicados, ambigüedad, temas) y pruebas de contrato antes de implementar cada técnica. | ✅ |
| IV. Commits atómicos y reversibles | Flags `dashboard` e `insights` (ajuste 5); cada técnica es un módulo y un commit independientes; el esquema de resultados es aditivo. | ✅ |
| V. Seguridad por defecto | Solo Admin; datos enviados al LLM anonimizados (sin autor); `ANTHROPIC_API_KEY` solo en Railway; el texto del LLM se renderiza como texto plano. | ✅ |
| VI. Observabilidad | Estado y progreso por etapa; duración por técnica en logs; errores parciales (una técnica falla y el resto sigue). | ✅ |
| VII. Humano en el bucle | Duplicados confirmados o rechazados por el Admin (sin tocar los detalles salvo confirmación, que usa la moderación de la 004); insights con evidencias y botón "no útil". | ✅ |
| Restricciones (v1.1.0) | Python 3.12 en `analytics`; Node 24; despliegue desde GitHub Actions. | ✅ |

**Re-evaluación post-diseño**: sin violaciones adicionales.

## Project Structure

### Documentation (this feature)

```text
specs/007-dashboard-analitico/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── analysis-job.md
│   ├── analysis-results.schema.json
│   └── dashboard.openapi.yaml
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/analytics.ts                      # Filtros, KPIs, AnalysisRun, AnalysisResults (zod)
apps/api/src/jobs/analysis.ts                         # cola "analysis" (patrón de jobs/detection.ts)
apps/api/src/jobs/analysis-schedule.ts                # schedulers por proyecto (FR-013)
apps/api/src/modules/dashboard/
├── descriptive.routes.ts                             # KPIs, distribuciones, serie temporal
├── descriptive.service.ts                            # pipelines de agregación
├── analysis.routes.ts                                # lanzar, estado, resultados, decisiones, feedback
├── analysis.service.ts                               # run, export al bucket, retorno, retención
└── models/{analysis-run,duplicate-decision,insight-feedback,analysis-settings}.ts
apps/api/migrations/20261029000000-analysis-indexes.js
apps/analytics/src/analytics/
├── queue_worker.py                                   # común a los workers de la 006 y la 007
└── mining/
    ├── worker.py                                     # cola "analysis" (analysis-worker)
    ├── schemas.py                                    # contrato v1 (pydantic)
    ├── run.py                                        # orquestador con progreso y fallos parciales
    ├── loader.py                                     # descarga de la entrada (URL firmada)
    ├── preprocess.py                                 # spaCy: normalización, lemas, stopwords
    ├── keywords.py                                   # c-TF-IDF por actividad + n-gramas
    ├── cooccurrence.py                               # red de términos (networkx)
    ├── embeddings.py                                 # sentence-transformers
    ├── topics.py                                     # BERTopic
    ├── clusters.py                                   # HDBSCAN sobre embeddings
    ├── duplicates.py                                 # similitud coseno + decisiones previas
    ├── sentiment.py                                  # pysentimiento
    ├── quality.py                                    # léxico ambiguo + heurísticas → puntaje
    ├── association.py                                # Apriori (mlxtend)
    ├── hotcold.py                                    # actividades calientes/frías
    ├── insights.py                                   # Claude + structured outputs + verificación de evidencias
    └── lexicon/ambiguous_es.txt
apps/analytics/tests/
├── fixtures/generate_details.py + details/validation.json   # 300 detalles etiquetados
├── unit/test_{mining_worker,preprocess,keywords,quality,duplicates,patterns,insights}.py
├── eval/test_{topics,quality_gates}.py               # SC-003, SC-004 y pureza de temas (analysis-eval)
└── contract/test_analysis_job.py
apps/analytics/Dockerfile.mining                      # imagen de analysis-worker con los modelos
apps/analytics/railway.mining.json
apps/web/src/features/dashboard/
├── DashboardPage.tsx, FiltersBar.tsx, StaleBanner.tsx
├── descriptive/{KpiTiles,Distributions,Timeline,CoverageMap}.tsx
├── text/{Keywords,WordCloud,CooccurrenceGraph,Topics,Clusters}.tsx
├── quality/{QualityList,DuplicatePairs}.tsx
├── patterns/{Sentiment,AssociationRules,HotColdActivities}.tsx
└── insights/{InsightsPanel,EvidenceDrawer}.tsx
e2e/flows/{dashboard-descriptive,dashboard-analysis}.spec.ts
e2e/perf/dashboard.perf.spec.ts
```

**Structure Decision**: la capa descriptiva en `api` (rápida, sin cola) y la analítica en el
paquete `mining/` de `analytics`, con un módulo por técnica y su propio servicio,
`analysis-worker` (ajuste 3). La infraestructura común de los workers (conexión, latido, salud)
se extrae de la 006 a `queue_worker.py`.

## Ajustes tras implementar la 002–006 (2026-10-02)

1. **El worker no accede a MongoDB (constitución II, como la 006)**. En lugar de leer `details`
   y escribir `analysis_runs`, `api` exporta el conjunto analizado (detalles filtrados **sin
   autor**, actividades con su nombre y decisiones de duplicados previas) a un JSON comprimido en
   el bucket (`projects/{projectId}/analysis/{runId}/input.json.gz`) y encola el job con una URL
   firmada de lectura y otra de escritura (`presignGet` ya existe; se añade `presignPut`, 15 min).
   El worker sube los resultados a `…/{runId}/results.json.gz` y devuelve solo un resumen
   (`status`, `stages`, `detailCount`). `api` valida el resultado con el esquema compartido y es
   la única que escribe `analysis_runs`. Desaparecen la escritura compartida, la lectura
   compartida de `details` y la caché `analysis_embeddings` en MongoDB (ver *Complexity
   Tracking*). Los archivos quedan bajo el prefijo del proyecto, así que la cascada de borrado
   de la 003 (`deletePrefix(projects/{id})`) también los elimina.
2. **Cola BullMQ como la 006**: cola `analysis` en `apps/api/src/jobs/analysis.ts` (mismo patrón
   que `jobs/detection.ts`: `Queue` + `QueueEvents`, prefijo `bull`, latido del worker en Redis
   y check en `/health/deep`). Contrato del job (versión 1) en `packages/shared` (zod) y en
   `analytics` (pydantic), con la prueba de contrato en ambos lados sobre los mismos ejemplos.
   `attempts: 1` y un límite de `ANALYSIS_TIMEOUT_S=900` (15 min), como `DETECTION_TIMEOUT_S`.
3. **Servicio aparte para la minería**: los modelos (spaCy, sentence-transformers, pysentimiento,
   torch) añaden más de 1,5 GB que la detección no necesita. Un `Dockerfile` propio,
   `apps/analytics/Dockerfile.mining` (torch **CPU** desde el índice de PyTorch, modelos
   descargados en el build), construye la imagen de un servicio nuevo, `analysis-worker`, que
   ejecuta `python -m analytics.mining.worker` (Railway construye la última etapa de un
   `Dockerfile`, así que no sirve una etapa extra en el de `analytics`); el job `build` del CI la
   añade a su matriz;
   `analytics` y `analytics-worker` siguen con la imagen ligera. Railway: mismas reglas que el
   worker de la 006 (configuración en `apps/analytics/railway.mining.json`, servicio creado antes
   de fusionar, `deploy.yml` lo añade al bucle). La cuenta admite 24 GB por servicio (medido en
   la 006), así que los 4 GB previstos no son un límite. **Aviso local**: la imagen ocupa ~3 GB;
   el disco del equipo de desarrollo tiene poco margen.
4. **Dependencias**: `scikit-learn` ≥ 1.3 trae `HDBSCAN`, así que no se añade el paquete
   `hdbscan`; BERTopic acepta ese modelo como `hdbscan_model`. Se mantienen `umap-learn`,
   `bertopic`, `sentence-transformers`, `spacy` + `es_core_news_md`, `pysentimiento`, `mlxtend` y
   `networkx`. Sin `pymongo` en el worker.
5. **Flags (constitución IV)**: uno por feature más uno operativo, como en la 006: `dashboard`
   (`default: false`; oculta las rutas `/projects/:id/dashboard`, `/projects/:id/analysis-runs`,
   `/analysis-runs/...`, `/duplicate-pairs/...`, `/insights/...` con `GATED_PREFIXES` y la entrada
   del menú con `useFlags`) e `insights` (`default: false`, coste del LLM). Sustituyen a
   `analytics-text` e `insights` del plan original. `dashboard` se activa por defecto al cerrar
   la feature y se retira después; `insights` queda como flag operativo.
6. **Insights con Claude**: SDK `anthropic` (ya en `analytics` desde la 006) con
   `beta.messages.parse` y salida estructurada (pydantic), modelo por defecto `claude-opus-5-5`
   configurable con `INSIGHTS_LLM_MODEL`, `fallbacks: "default"` ante una negativa y 60 s de
   límite; sin `ANTHROPIC_API_KEY` la etapa queda `skipped`. Se envían agregados y textos de
   detalles, nunca nombres ni emails (el export del ajuste 1 ya no los contiene). La
   verificación de evidencias y cifras de R10 se mantiene.
7. **Datos de la 004**: un detalle pertenece a `diagramId` + `activityKey` (la `key` estable de la
   actividad entre versiones), con `given`, `when`, `then`, `type` (`functional`,
   `non_functional`, `business_rule`, `constraint`), `priority` MoSCoW o nula, `authorRole`,
   `tags`, `status` (`pending`, `validated`, `duplicate`, `discarded`), `duplicateOf`, votos y
   comentarios. La distribución *por rol* usa `authorRole`; la cobertura reutiliza
   `coverageOf` (`modules/details/coverage.ts`) y el nombre de la actividad sale de la versión
   publicada. Confirmar un duplicado llama al servicio de moderación de la 004 (el de
   `POST /details/:id/status`), no inserta directamente.
8. **Progreso sin socket**: las salas de la 005 son del espacio de trabajo de un diagrama
   (`room:join` con `versionId`); el dashboard no se une a ninguna. Un análisis tarda minutos, así
   que la web consulta `GET /analysis-runs/:id` cada 3 s mientras está `pending` o `running`; no
   se añaden eventos de Socket.IO.
9. **Análisis programado**: `upsertJobScheduler` de BullMQ en `api` (un scheduler por proyecto con
   la programación activada), que solo encola si hubo cambios desde el último run
   (`dataFingerprint`). Es P3 dentro de la feature y va después de US1–US5.
10. **Web**: página `/proyectos/:id/dashboard` (solo Administrador; enlace en la cabecera del
    proyecto). Gráficos con ECharts siguiendo la guía *dataviz* (paleta validada en claro y
    oscuro, texto alternativo y tabla accesible por gráfico). El mapa de cobertura reutiliza
    la escala de color del mapa de calor de la 004 sobre la imagen del diagrama, con una
    zona pulsable por actividad publicada. No reutiliza el canvas de three.js de la 003: está
    acoplado a su página (cámara, edición, tiempo real) y aquí basta una imagen con zonas
    accesibles (constitución VII).
11. **Conjunto de validación**: generado y versionado como el de la 006
    (`apps/analytics/tests/fixtures/generate_details.py`, 300 detalles con 3 temas, pares de
    duplicados y términos ambiguos etiquetados), con un job `analysis-eval` en el CI que falla
    si no se alcanzan SC-003, SC-004 y la pureza de temas. Se propone añadirlo a los checks
    obligatorios de `main` (en la 006, `detection-eval` no lo es).
12. **Migración**: `20261029000000-analysis-indexes.js` (posterior a la de la 006), sin el índice
    TTL de `analysis_embeddings`.
13. **Estados del run (constitución VI)**: `pending`, `running`, `done` y `failed`, como la
    detección de la 006. Un análisis con alguna etapa fallida termina `done` con
    `partial: true`, y `stages` indica cuáles fallaron, se omitieron o terminaron.
14. **Definiciones y filtros**: un *participante activo* es quien creó al menos un detalle, votó o
    comentó dentro del rango filtrado; la serie temporal agrupa por día en la zona horaria del
    proyecto (`analysis_settings.schedule.timezone`, `America/Guayaquil` por defecto). El
    análisis acepta los mismos filtros que lo descriptivo (FR-003) al lanzarse, y el dashboard
    muestra con qué filtros se calculó. Si tras verificar las evidencias quedan menos de 3
    insights, se reintenta una vez indicando los descartados; si siguen faltando, se muestran
    los que haya con un aviso.
15. **Seguridad de los gráficos (constitución V)**: los tooltips y etiquetas de ECharts con
    texto de los detalles pasan por un formateador que lo escapa (ECharts interpreta HTML en los
    tooltips).
16. **Imagen pesada en el CI**: `analysis-worker` va en el perfil `mining` de Compose
    (`pnpm dev:up:mining` en local). Con el flag `dashboard`, `api /health/deep` exige un
    worker de minería vivo (como el de la detección), así que el job `e2e-smoke` levanta ese
    perfil con la imagen tomada de la caché de GitHub Actions del job `build`, sin construirla
    desde cero, y ejecuta también el E2E del análisis. El job `analysis-eval` ejecuta las
    pruebas y los gates con los modelos reales en el runner (`uv run --group mining`), con los
    modelos en la caché de Actions. La cobertura de `analytics` combina `test-python` y
    `analysis-eval`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Imagen `mining` de ~3 GB (modelos de spaCy, sentence-transformers y pysentimiento incluidos) en un servicio aparte (`analysis-worker`) | Los análisis deben funcionar sin descargas en tiempo de ejecución y con arranques predecibles; separarla evita que la detección y `analytics` carguen esos modelos | Descargar los modelos al arrancar ralentiza cada despliegue y falla si el hub externo no está disponible; una sola imagen para los tres servicios triplicaría el peso de la detección |

La escritura compartida de `analysis_runs` del plan original desaparece con el ajuste 1: los
resultados viajan por el bucket y solo `api` escribe en MongoDB.
