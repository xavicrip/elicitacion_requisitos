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
**Primary Dependencies**: `analytics`: `bullmq`, `spacy` + `es_core_news_md`, `scikit-learn`, `sentence-transformers` (`paraphrase-multilingual-MiniLM-L12-v2`), `bertopic`, `umap-learn`, `hdbscan`, `pysentimiento`, `mlxtend`, `networkx`, `pymongo`, `anthropic`. `web`: `echarts` + `echarts-for-react` + `echarts-wordcloud`
**Storage**: MongoDB: `analysis_runs` (escritura de `analytics`, lectura de `api`), `duplicate_decisions`, `insight_feedback`, `analysis_settings` (propiedad de `api`); lectura de `details`, `activities` y `diagram_versions`
**Testing**: pytest por técnica con el **conjunto de validación etiquetado** (300 detalles sintéticos con temas, duplicados y ambigüedades conocidos) y gates de métricas; Vitest (agregaciones descriptivas contra datos semilla con resultados calculados a mano); Playwright (dashboard y filtros); evaluación manual de insights con analistas (SC-005)
**Target Platform**: `analytics-worker` con 4 GB de RAM y CPU (sin GPU)
**Project Type**: Aplicación web + servicio analítico
**Performance Goals**: dashboard descriptivo < 3 s con 2 000 detalles (SC-001); análisis completo < 5 min con 2 000 detalles (SC-002)
**Constraints**: modelos incluidos en la imagen (sin descargas en tiempo de ejecución); el análisis no degrada la API (proceso separado, concurrencia 1 por réplica); al LLM no se envían nombres ni emails; los análisis de texto exigen ≥ 20 detalles
**Scale/Scope**: ≤ 5 000 detalles por proyecto; 1 análisis activo por proyecto

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento | Estado |
|-----------|--------------|--------|
| I. Requisito anclado a la actividad | Todas las métricas se calculan por actividad; los insights enlazan a detalles y actividades concretos. | ✅ |
| II. Servicios desacoplados | Contrato de la cola en `contracts/analysis-job.md`; esquema de resultados versionado (`schemaVersion`) validado en ambos lados. `analysis_runs` se declara **compartida** (la crea `api` y escribe `results` `analytics`); lecturas de `details`/`activities` declaradas en la 004. | ✅ (justificado abajo) |
| III. Pruebas primero | Gates de métricas sobre el conjunto de validación (duplicados, ambigüedad, temas) y pruebas de contrato antes de implementar cada técnica. | ✅ |
| IV. Commits atómicos y reversibles | Flags `analytics-text` e `insights`; cada técnica es un módulo y un commit independientes; el esquema de resultados es aditivo. | ✅ |
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
apps/api/src/modules/dashboard/
├── descriptive.routes.ts                             # KPIs, distribuciones, serie temporal
├── descriptive.service.ts                            # pipelines de agregación
├── analysis.routes.ts                                # lanzar, estado, resultados, decisiones, feedback
├── analysis.queue.ts                                 # cola "analysis" + job programado nocturno
└── models/{analysis-run,duplicate-decision,insight-feedback,analysis-settings}.ts
apps/api/migrations/20261029000000-analysis-indexes.js
apps/analytics/src/analytics/
├── worker.py                                         # (compartido con la 006) + cola "analysis"
└── mining/
    ├── run.py                                        # orquestador con progreso y fallos parciales
    ├── loader.py                                     # lectura de detalles (proyección sin autor)
    ├── preprocess.py                                 # spaCy: normalización, lemas, stopwords
    ├── keywords.py                                   # c-TF-IDF por actividad + n-gramas
    ├── cooccurrence.py                               # red de términos (networkx)
    ├── embeddings.py                                 # sentence-transformers (caché por hash del texto)
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
├── fixtures/validation_set.json                      # 300 detalles etiquetados
├── unit/test_{preprocess,keywords,quality,duplicates,association,hotcold}.py
├── eval/test_quality_gates.py                        # SC-003, SC-004 y pureza de temas
└── contract/test_analysis_job.py
apps/web/src/features/dashboard/
├── DashboardPage.tsx, FiltersBar.tsx, StaleBanner.tsx
├── descriptive/{KpiTiles,Distributions,Timeline,CoverageMap}.tsx
├── text/{Keywords,WordCloud,CooccurrenceGraph,Topics,Clusters}.tsx
├── quality/{QualityList,DuplicatePairs}.tsx
├── patterns/{Sentiment,AssociationRules,HotColdActivities}.tsx
└── insights/{InsightsPanel,EvidenceDrawer}.tsx
e2e/{dashboard-descriptive,dashboard-analysis}.spec.ts
```

**Structure Decision**: la capa descriptiva en `api` (rápida, sin cola) y la analítica en el
paquete `mining/` de `analytics`, con un módulo por técnica. La infraestructura del worker
(`worker.py`, servicio `analytics-worker` en Railway) la crea la primera de las features 006 o
007 que se integre en `main`; la segunda solo registra su cola.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `analysis_runs` escrita por dos servicios (`api` crea el documento y `analytics` escribe `results`/`status`) | Los resultados de 5 000 detalles (embeddings 2D, temas, pares) pueden superar varios MB, un tamaño inadecuado para el valor de retorno del job en Redis | Devolverlos por Redis (006, R2) llenaría la memoria de Redis; un endpoint HTTP de subida desde `analytics` a `api` añade acoplamiento síncrono y reintentos. La escritura se limita a los campos `status`, `progress`, `results` y `error` de documentos creados por `api`. |
| Imagen de `analytics` de ~2,5 GB (modelos de spaCy, sentence-transformers y pysentimiento incluidos) | Los análisis deben funcionar sin descargas en tiempo de ejecución y con arranques predecibles | Descargar los modelos al arrancar ralentiza cada despliegue y falla si el hub externo no está disponible |
