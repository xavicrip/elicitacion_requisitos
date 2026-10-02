# ADR 0008: Detección asistida de actividades con OpenCV, Tesseract y un worker de BullMQ

- **Estado**: aceptado
- **Fecha**: 2026-10-02
- **Feature**: 006-deteccion-asistida (research R1–R9; plan, ajustes 1–13)

## Contexto

La 006 propone automáticamente las actividades, decisiones, nodos de inicio y fin y las
transiciones de un diagrama subido, con el texto de cada zona, para que el Administrador las
revise antes de publicar. La constitución exige que todo resultado automático sea una
propuesta revisada por una persona (VII), que cada servicio sea dueño de sus colecciones (II) y
que introducir una tecnología fuera de la lista de restricciones tenga un ADR. La detección es
intensiva en CPU (OCR) y puede tardar decenas de segundos; la cuenta de Railway admite una
réplica por servicio y quizá solo 0,5 GB de RAM (ADR 0002).

## Decisión

1. **Visión clásica en `analytics`**: OpenCV (`opencv-python-headless`) para binarizar, encontrar
   contornos y clasificar formas UML, y **Tesseract 5** (`pytesseract`, `spa+eng`) para leer el
   texto de cada zona. Los umbrales se ajustan con un conjunto de validación generado y
   versionado, con un gate de precisión en el CI (zonas ≥ 0,85 y etiquetas ≥ 0,80 en diagramas
   digitales).
2. **Cola BullMQ entre Node y Python**: `api` encola en `detection` con `bullmq` (como el borrado
   de proyectos de la 002) y un worker de Python con el paquete oficial `bullmq` la consume. El
   contrato del job (entrada, progreso y resultado, versión 1) vive en `packages/shared` (zod) y
   en `analytics` (pydantic), con una prueba de contrato en cada lado sobre los mismos ejemplos.
3. **El worker no escribe en MongoDB**: descarga la imagen display por una URL firmada de 10 min
   y devuelve el resultado como valor de retorno del job; `api` lo valida y guarda las
   propuestas (Principio II).
4. **Propuestas con revisión obligatoria**: nada se convierte en actividad sin aceptación
   explícita; las que se superponen con actividades existentes se marcan como posible duplicado
   y no se aceptan en bloque. Publicar con propuestas pendientes se bloquea mediante un registro
   de condiciones de publicación (`registerPublishGuard`) que no acopla el módulo de diagramas a
   la detección.
5. **Refinamiento opcional con Claude**: con el flag `detection-llm` y `ANTHROPIC_API_KEY`, el
   SDK `anthropic` de Python envía la imagen y las zonas detectadas y pide correcciones con
   salida estructurada. Solo la imagen del diagrama sale del sistema; con un fallo, una negativa
   o más de 30 s, se sigue con el resultado local.
6. **Servicio aparte en Railway**: `analytics-worker` usa la imagen de `analytics` con otro
   comando, procesa una detección a la vez por defecto y expone un `GET /health` mínimo para el
   healthcheck; así el OCR no bloquea el `/health` ni las peticiones de `analytics`. Además
   escribe un latido en Redis que `api /health/deep` comprueba.
7. **Estados del job**: `pending`, `running`, `done` y `failed` (constitución VI), con el
   progreso por etapas publicado en tiempo real por Socket.IO (005) y consultable por REST.
8. **Detrás del flag `detection` mientras se construyó.** Sin él, `api` no montaba la cola ni
   las rutas y la web no mostraba la detección; se activó por defecto tras el recorrido en
   staging y se retiró después (`docs/feature-flags.md`). `detection-llm` sigue como flag
   operativo por su coste.

## Resultados (T046, 2026-10-02)

Medidos en local con Docker Compose (detalle en `specs/006-deteccion-asistida/plan.md`,
sección _Mediciones_):

- **Gate de precisión** (20 diagramas digitales del conjunto de validación): zonas 100 % y
  nombres 100 %, frente al mínimo de 85 % y 80 %. En los escaneos y fotos simulados, también
  100 %. Las transiciones (sin gate): recall y precisión del 100 % en los tres subconjuntos.
- **Tiempo**: 8,0 s de punta a punta para el diagrama de 50 actividades (objetivo < 60 s).
- **Memoria del worker**: 100 MB en reposo y 168 MB de pico (objetivo < 400 MB), compatible con
  los 0,5 GB del plan Free de Railway.

El conjunto es sintético y limpio; con diagramas reales la precisión será menor, por eso la
revisión humana sigue siendo obligatoria. Si en uso real no se alcanza SC-001, la evolución
prevista es el detector entrenado de las alternativas.

Decisiones de la implementación que no estaban en el plan:

- **Formas sin texto**: el inicio, el fin y las decisiones sin nombre se aceptan como «Inicio»,
  «Fin» y «Decisión» (la 003 exige un nombre); solo una acción sin nombre exige escribirlo.
- **Dirección de las flechas**: la punta es el triángulo relleno que queda pegado a una forma;
  con ruido de escaneo, otra mancha cerca del origen invertía la flecha.
- **Refinamiento**: activa el _fallback_ del lado del servidor ante una negativa por política
  (otro modelo en la misma llamada); el modelo por defecto es `claude-opus-5-5`, configurable con
  `DETECTION_LLM_MODEL`.

## Alternativas descartadas

- **Detector entrenado (YOLO o similar)**: mejor en fotos de pizarra, pero requiere etiquetar
  cientos de imágenes y GPU; queda como evolución si no se alcanza SC-001.
- **EasyOCR o PaddleOCR**: mejores con texto de escena, pero imágenes de más de 1 GB con PyTorch
  y más lentos en CPU, incompatibles con la memoria disponible.
- **Celery**: otro protocolo y otro broker; BullMQ ya existe en `api`.
- **Llamada HTTP síncrona a `analytics`**: bloquea hasta un minuto, sin reintentos ni progreso.
- **Worker en el mismo proceso que FastAPI**: los jobs largos degradarían `/health` y harían
  fallar el healthcheck.
- **Depender solo de un modelo multimodal**: coste por diagrama y dependencia externa para algo
  que la visión local resuelve en los diagramas digitales.
