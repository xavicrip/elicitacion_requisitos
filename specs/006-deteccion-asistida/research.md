# Research: Detección asistida de actividades en la imagen

**Feature**: 006-deteccion-asistida | **Date**: 2026-09-25

## R1. Cola de trabajos entre Node y Python

- **Decision**: **BullMQ** en ambos lados: `api` usa `Queue` y `QueueEvents` (Node) y
  `analytics-worker` usa el paquete oficial `bullmq` de Python (`Worker`). Cola `detection`,
  `attempts: 2`, backoff exponencial, `removeOnComplete: 1000`. Progreso con
  `job.updateProgress({stage, pct})`.
- **Rationale**: el Redis ya existe (001) y BullMQ se usa también en la 002; una sola
  tecnología de colas para las features 006–008.
- **Alternatives considered**: Celery (otro protocolo y otro broker de facto); una llamada HTTP
  síncrona a `analytics` (bloquea hasta 60 s, sin reintentos ni progreso).

## R2. Propiedad de los datos del resultado

- **Decision**: el worker **devuelve** `DetectionResult` como valor de retorno del job (JSON
  < 200 KB para 100 zonas). `api` escucha `completed` en `QueueEvents`, valida con zod y
  persiste las propuestas. El worker no tiene credenciales de escritura de las colecciones de
  `api`.
- **Rationale**: Principio II (cada colección tiene un solo dueño).

## R3. Detección de formas

- **Decision**: pipeline OpenCV:
  1. Escalar a ≤ 3000 px por lado; escala de grises; `adaptiveThreshold` (gaussiana, bloque 31).
  2. `findContours` (`RETR_TREE`) + `approxPolyDP` (ε = 2 % del perímetro).
  3. Clasificación:
     - **action**: 4–8 vértices, `aspect ∈ [1,2; 8]`, esquinas redondeadas (relación
       área / área del rectángulo envolvente ∈ [0,85; 0,97]).
     - **decision**: 4 vértices con diagonales alineadas a los ejes (rombo), relación de área ≈ 0,5.
     - **start**: círculo (circularidad > 0,85) **relleno** (media de intensidad interior < 80).
     - **end**: círculo con un círculo concéntrico relleno (jerarquía de contornos).
  4. Se descartan los contornos < 0,1 % del área y los contenidos en otra forma aceptada
     (texto dentro de las actividades).
  5. **Confianza** = combinación de la calidad del ajuste geométrico y la confianza del OCR →
     `high` (≥ 0,8), `medium` (≥ 0,5), `low`.
- **Rationale**: los diagramas UML de herramientas (caso principal, SC-001) tienen formas
  limpias y regulares; los umbrales se ajustan con el conjunto de validación.
- **Alternatives considered**: un detector entrenado (YOLO) con un dataset de diagramas UML
  (mejor en fotos de pizarra, pero requiere etiquetar cientos de imágenes y GPU; se deja como
  evolución si no se alcanza SC-001).

## R4. OCR

- **Decision**: Tesseract 5 (`pytesseract`), `--oem 1 --psm 6`, idiomas `spa+eng`, sobre cada
  zona recortada con un margen de 4 px, escalada ×2 y binarizada con Otsu. Limpieza: unir
  líneas, eliminar caracteres sueltos no alfanuméricos y normalizar espacios. Confianza media
  por palabra de `image_to_data`. Texto vacío o confianza < 40 → `label: ""` y confianza baja
  (edge case de manuscritos).
- **Alternatives considered**: EasyOCR o PaddleOCR (mejores en texto de escena, pero imágenes
  Docker de más de 1 GB con PyTorch y más lentos en CPU).

## R5. Refinamiento con modelo multimodal (opcional)

- **Decision**: si el flag `detection-llm` está activo y existe `ANTHROPIC_API_KEY`, se envía a
  **Claude Sonnet 5** (`claude-sonnet-5`, SDK `anthropic` de Python) la imagen del diagrama
  junto con las zonas detectadas (JSON con bbox, tipo y texto OCR), y se pide con *structured
  outputs* (esquema JSON) una corrección de `label` y `type` por zona y posibles zonas
  omitidas. Las correcciones sustituyen las del OCR solo si el modelo devuelve la misma zona
  (IoU ≥ 0,7); las zonas nuevas entran con confianza `medium`. Con timeout de 30 s, si falla se
  sigue con el resultado local.
- **Rationale**: mejora los nombres (SC-002) en texto pequeño o con tildes sin depender del LLM
  para funcionar (supuesto de la spec: "si no está configurado, detección local").
- **Privacidad**: solo se envía la imagen del diagrama; nunca datos de usuarios.

## R6. Transiciones (P3)

- **Decision**: sobre la máscara binaria sin las formas detectadas: `HoughLinesP` → unir
  segmentos colineales → detectar la punta de flecha (triángulo pequeño en un extremo) → el
  origen es la forma más cercana al extremo sin punta y el destino la más cercana a la punta
  (distancia < 3 % de la diagonal). Confianza según la nitidez de la punta y las distancias.
- **Rationale**: suficiente para flujos ortogonales típicos; al ser P3, no bloquea la entrega.

## R7. Revisión en el editor

- **Decision**: `ProposalsLayer` dibuja las propuestas con borde discontinuo y color por
  confianza (verde, ámbar, gris) **más un icono y un texto** (no solo color). Las propuestas que
  se superponen (IoU ≥ 0,5) con actividades existentes se marcan como `possible_duplicate` y
  quedan excluidas de "Aceptar todas las de confianza alta". Aceptar → `POST
  /proposals/:id/accept` con correcciones opcionales → crea la `activity` (`source: detected`).
  Volver a ejecutar la detección → las propuestas `pending` anteriores pasan a `superseded`.
- **Rationale**: US2 y edge cases de re-ejecución y superposición.

## R8. Evaluación y gate de CI

- **Decision**: 30 diagramas (20 exportados de PlantUML, draw.io y StarUML; 5 escaneados;
  5 fotos) con *ground truth* JSON. `evaluate_detection.py` empareja por IoU ≥ 0,5 y calcula el
  *recall* de zonas y tipos, y la exactitud de las etiquetas (similitud normalizada ≥ 0,9)
  **solo sobre el subconjunto digital** para los gates: zonas ≥ 0,85 (SC-001), etiquetas
  ≥ 0,80 (SC-002). Job `detection-eval` en CI (solo si cambia `apps/analytics/src/analytics/detection/**`).
  El refinamiento con LLM se evalúa aparte, de forma manual (coste).

## R9. Despliegue

- **Decision**: la imagen de `analytics` instala `tesseract-ocr`, `tesseract-ocr-spa` y
  `tesseract-ocr-eng` (apt) y `libgl` no es necesario (versión headless de OpenCV). Nuevo
  servicio Railway `analytics-worker` con la misma imagen y el *start command*
  `python -m analytics.worker`, con su `railway.json` (healthcheck desactivado; reinicio
  `ON_FAILURE`). `deploy.yml` añade `railway up --service analytics-worker`. Nuevas variables:
  `ANTHROPIC_API_KEY` (opcional), `DETECTION_CONCURRENCY` (por defecto 2), `DETECTION_TIMEOUT_S`
  (por defecto 180).
