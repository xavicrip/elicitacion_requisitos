# Research: Dashboard analítico con minería de datos y de texto

**Feature**: 007-dashboard-analitico | **Date**: 2026-09-25

## R1. Dónde calcular cada cosa

- **Decision**: lo **descriptivo** en `api` (agregaciones de MongoDB con índices, < 3 s; se
  actualiza al instante con filtros) y lo **analítico** en `analytics` (Python), de forma
  asíncrona, con resultados persistidos por ejecución.
- **Rationale**: SC-001 exige inmediatez para los KPIs; las técnicas de ML necesitan el
  ecosistema de Python y minutos de CPU (SC-002).

## R2. Preprocesamiento en español

- **Decision**: spaCy `es_core_news_md` (tokenización, lematización, POS). Texto analizado por
  detalle = `given + " " + when + " " + then`, con los componentes también por separado para la
  calidad. Normalización: minúsculas, sin URLs ni números aislados; stopwords de spaCy más una
  lista de dominio ("sistema", "usuario", "debe"…) configurable por proyecto. Los n-gramas
  (1–3) se construyen sobre los lemas.
- **Alternatives considered**: NLTK + Snowball (el stemming degrada la legibilidad de las
  palabras clave); Stanza (más lento en CPU).

## R3. Palabras clave, nube y coocurrencia

- **Decision**: **c-TF-IDF** tratando cada actividad como una "clase" (términos distintivos de
  una actividad frente a las demás); top 15 por actividad. La nube de palabras usa la frecuencia
  global de lemas (top 100). Coocurrencia: ventana = detalle, se conservan los pares con
  PMI > 0 y frecuencia ≥ 3, grafo con networkx, comunidades de Louvain para colorear;
  exportado como nodos y aristas (top 150 aristas).

## R4. Embeddings, temas y grupos

- **Decision**: `paraphrase-multilingual-MiniLM-L12-v2` (384 dimensiones, rápido en CPU,
  multilingüe). Caché de embeddings en `analysis_embeddings` indexada por `sha256(texto)` para
  no recalcular los detalles sin cambios.
  - **Temas**: BERTopic con los embeddings precalculados, UMAP (5D) + HDBSCAN
    (`min_cluster_size = max(5, n/50)`) y el vectorizador c-TF-IDF con los lemas de R2; salida:
    tema, términos, número de detalles y actividades. Con menos de 20 detalles no se ejecuta
    (US2-5).
  - **Grupos semánticos**: HDBSCAN sobre los embeddings reducidos (UMAP 5D), `min_cluster_size=3`;
    más una proyección UMAP 2D para el gráfico de dispersión.
- **Rationale**: BERTopic es el estándar actual para textos cortos; comparte los embeddings con
  los grupos y los duplicados.
- **Alternatives considered**: LDA (rinde mal con textos cortos de 20–60 palabras).

## R5. Casi duplicados

- **Decision**: similitud coseno entre todos los pares (n ≤ 5 000 → matriz por bloques);
  candidatos con `sim ≥ 0,85` **y** misma actividad o `sim ≥ 0,92` entre actividades. Se excluyen
  los pares con una decisión previa (`duplicate_decisions`: confirmed/rejected), como pide
  US3-3. Confirmar → `POST /details/:id/status {duplicate}` de la 004.
- **Validación**: umbral calibrado sobre el conjunto de validación para lograr recall ≥ 0,80 y
  una tasa de falsos positivos < 0,20 (SC-003).

## R6. Sentimiento

- **Decision**: `pysentimiento` (`robertuito-sentiment-analysis`, español) → POS/NEU/NEG con
  probabilidades por detalle; agregado por actividad; top 10 más negativos.
- **Nota**: el modelo está entrenado con tweets; los requisitos suelen ser neutros, así que se
  destaca solo NEG ≥ 0,7 para evitar ruido.

## R7. Calidad del requisito

- **Decision**: puntaje de 0 a 100 = 100 − penalizaciones, cada una con una explicación:
  - término del **léxico ambiguo** (`lexicon/ambiguous_es.txt`: "rápido", "fácil", "amigable",
    "intuitivo", "eficiente", "adecuado", "etc.", "y/o", "flexible", "mínimo"…; ampliable por
    proyecto en `analysis_settings`) → −15 cada uno (máx. −45), con la sugerencia "hazlo medible";
  - "Entonces" sin verbo observable (POS) o sin cifra cuando el tipo es No funcional → −15;
  - componente con menos de 4 palabras de contenido → −10;
  - "Cuando" sin verbo → −10;
  - pronombres sin antecedente ("esto", "eso") → −5.
- **Validación**: recall ≥ 0,80 sobre los términos ambiguos etiquetados (SC-004).
- **Alternatives considered**: un clasificador supervisado (no hay datos etiquetados reales
  suficientes; las reglas son explicables, como pide la spec).

## R8. Reglas de asociación

- **Decision**: transacciones = detalle con los ítems `tag:*`, `type:*`, `priority:*` y
  `activity:*`; `mlxtend.apriori` (soporte mínimo 0,05) + `association_rules`
  (confianza ≥ 0,6, lift > 1,2); top 30 por lift, con una frase generada por plantilla
  ("Cuando la etiqueta es *pagos*, el 70 % de los requisitos son No funcionales").

## R9. Actividades calientes y frías

- **Decision**: por actividad, z-score de volumen, votos efectivos, comentarios y
  "desacuerdo" (proporción de detalles descartados o con sentimiento negativo). **Caliente** si
  la suma ponderada es ≥ +1,5 σ; **fría** si tiene 0 detalles o ≤ −1 σ en volumen. Se muestra el
  motivo (el componente dominante).

## R10. Insights con LLM

- **Decision**: **Claude Sonnet 5** (`claude-sonnet-5`, SDK `anthropic`) con *structured outputs*
  (esquema JSON): entrada = resumen compacto de los resultados (KPIs, top temas, calidad,
  reglas, calientes y frías, con **IDs de evidencia**) y hasta 200 detalles representativos
  (los más votados y los centroides de cada tema), **sin autor**. Salida: 3–10 insights
  `{ title, statement, recommendation, evidence: [{kind, id}] }`. **Verificación**: se
  descartan los insights con evidencias que no existen en los resultados o con cifras que no
  cuadran con los datos (comparación automática de porcentajes con un margen de ±2 puntos).
  El feedback "no útil" se guarda y se añade a las instrucciones de ejecuciones futuras del
  proyecto como "evitar insights como…".
- **Rationale**: FR-012 y SC-006 (100 % con evidencia); Principio VII.
- **Fallo del proveedor**: la etapa `insights` queda `failed` y el resto de resultados siguen
  disponibles (US5-4).

## R11. Ejecución, programación y obsolescencia

- **Decision**: `POST /projects/:id/analysis-runs` crea el run (`queued`) y encola en `analysis`
  (índice único parcial: 1 activo por proyecto → 409). BullMQ *job scheduler* nocturno
  (`0 3 * * *` en la zona horaria del proyecto; por defecto America/Guayaquil) para los
  proyectos abiertos con cambios desde el último run. **Obsolescencia**: el run guarda
  `dataFingerprint = {count, maxUpdatedAt}`; el dashboard compara con el estado actual y
  muestra "Análisis desactualizado: N detalles nuevos".
- **Fallos parciales**: cada técnica se ejecuta dentro de un `try` con su propio estado
  en `results.stages[técnica]`.

## R12. Visualización

- **Decision**: **ECharts** (barras, líneas, dispersión 2D de grupos, grafo con fuerzas para la
  coocurrencia, `echarts-wordcloud`, heatmap), con la paleta de la guía *dataviz* del proyecto y
  soporte de tema claro y oscuro. El mapa de cobertura reutiliza el canvas three.js de la 003
  con el overlay `heatmap` de la 004.
- **Alternatives considered**: Recharts (sin grafo de red ni nube de palabras nativos).

## R13. Rendimiento

- Estimación con 2 000 detalles en 2 vCPU: spaCy ~40 s, embeddings ~60 s (con caché, solo los
  nuevos), BERTopic + HDBSCAN ~30 s, sentimiento ~70 s, resto < 20 s, LLM ~20 s → **~4 min**
  (SC-002). `torch.set_num_threads` = vCPU disponibles.
