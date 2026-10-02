# ADR 0009: Dashboard analítico con agregaciones en `api` y minería de texto en un worker de Python

- **Estado**: aceptado
- **Fecha**: 2026-10-02
- **Feature**: 007-dashboard-analitico (research R1–R13; plan, ajustes 1–16)

## Contexto

La 007 da al Administrador un dashboard del levantamiento: indicadores descriptivos con
filtros y un análisis de los detalles en español (palabras clave, temas, grupos, casi
duplicados, sentimiento, calidad, reglas de asociación, actividades críticas e insights en
lenguaje natural). La constitución exige que cada servicio sea dueño de sus colecciones (II),
que los resultados automáticos sean propuestas (VII), que los trabajos asíncronos tengan un
estado consultable (VI) y que introducir una tecnología fuera de la lista de restricciones
tenga un ADR. Los modelos de minería pesan más de 1,5 GB y el análisis de 2 000 detalles tarda
minutos de CPU.

## Decisión

1. **Dos capas**: lo descriptivo (KPIs, distribuciones, serie temporal, cobertura) se calcula en
   `api` con agregaciones de MongoDB en cada petición, con los filtros aplicados; lo analítico
   se calcula de forma asíncrona en Python y se guarda por ejecución.
2. **Minería en Python** (`analytics`, grupo de dependencias `mining`): spaCy con
   `es_core_news_md` para el preprocesamiento, c-TF-IDF y networkx para palabras clave y
   coocurrencia, `sentence-transformers` (`paraphrase-multilingual-MiniLM-L12-v2`) para los
   embeddings, UMAP y el `HDBSCAN` de scikit-learn con c-TF-IDF para temas y grupos (la cadena de
   BERTopic, sin su envoltorio ni sus dependencias), similitud coseno del texto y de cada parte
   (Dado, Cuando, Entonces) para los casi duplicados, `pysentimiento` para el sentimiento, reglas explicables con
   un léxico configurable para la calidad y `mlxtend` (Apriori) para las reglas de asociación.
   torch se instala en su variante CPU.
3. **El worker no accede a MongoDB**: `api` exporta el conjunto analizado (detalles filtrados sin
   autor, nombres de actividad y decisiones de duplicados previas) al bucket y encola el job en
   la cola BullMQ `analysis` con una URL firmada de lectura y otra de escritura. El worker sube
   los resultados al bucket y devuelve un resumen; `api` los valida con el esquema compartido y
   es la única que escribe `analysis_runs` (Principio II). Los archivos viven bajo el prefijo del
   proyecto, así que la cascada de borrado de la 003 también los elimina.
4. **Servicio aparte `analysis-worker`**: imagen propia (`apps/analytics/Dockerfile.mining`, con
   los modelos descargados en el build), para que `analytics` y el worker de detección sigan con
   la imagen ligera. Expone `GET /health` y un latido en Redis que `api /health/deep` comprueba.
5. **Estados** `pending`, `running`, `done` y `failed` (constitución VI); un análisis con alguna
   etapa fallida termina `done` con `partial: true`, y cada etapa informa si terminó, falló o se
   omitió (con menos de 20 detalles, las técnicas de texto se omiten).
6. **Humano en el bucle**: ningún resultado cambia un detalle; confirmar un casi duplicado aplica
   la moderación de la 004 y rechazarlo evita que vuelva a proponerse.
7. **Insights con Claude** (flag `insights`, solo con `ANTHROPIC_API_KEY`): SDK `anthropic` con
   salida estructurada, modelo por defecto `claude-opus-5-5` (`INSIGHTS_LLM_MODEL`) y _fallback_
   del servidor ante una negativa. Se envían agregados y textos de detalles, nunca nombres ni
   emails; cada insight cita evidencias que se verifican contra los resultados y se descarta si
   no cuadran. Sin el servicio, el resto del dashboard funciona.
8. **ECharts** en `web` (barras, líneas, dispersión, grafo de fuerzas y nube de palabras con
   `echarts-wordcloud`), con la paleta de la guía _dataviz_, tabla accesible por gráfico y el
   texto de los detalles escapado en los tooltips.

## Alternativas descartadas

- **Leer `details` y escribir `analysis_runs` desde el worker** (plan original): obliga a
  declarar colecciones compartidas y reparte la escritura entre dos servicios.
- **Devolver los resultados por Redis**, como la detección: los resultados de 5 000 detalles
  pueden ocupar varios MB.
- **Una sola imagen para `analytics`, la detección y la minería**: triplicaría el peso de los
  servicios que no usan los modelos.
- **LDA** para los temas: rinde mal con textos de 20–60 palabras.
- **BERTopic como dependencia**: su cadena (embeddings, UMAP, HDBSCAN y c-TF-IDF) se implementa
  directamente en pocas líneas, con pureza de 0,99 en el conjunto de validación y una imagen más
  ligera.
- **NLTK con stemming**: degrada la legibilidad de las palabras clave.
- **Un clasificador supervisado de calidad**: no hay datos etiquetados reales; las reglas son
  explicables, como pide la spec.
- **Recharts**: no tiene grafo de red ni nube de palabras.
