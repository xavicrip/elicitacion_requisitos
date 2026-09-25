# Título

**ReqCanvas** — Sistema web colaborativo para el levantamiento de requisitos a partir de diagramas UML de actividades.

---

# 1. Contexto y objetivo

Quiero desarrollar una aplicación web colaborativa, al estilo de Miro o Mural, para recopilar requisitos y necesidades de los usuarios a partir de un **diagrama UML de actividades**.

El administrador sube la imagen de un diagrama de actividades. El sistema la convierte en un **espacio de trabajo interactivo (canvas)**, en el que cada actividad del diagrama es un elemento seleccionable. Los participantes entran al espacio de trabajo, seleccionan una actividad y registran **detalles de requisitos** con una estructura tipo escenario (Dado / Cuando / Entonces). Varios usuarios pueden aportar detalles sobre la misma actividad o sobre actividades distintas, en tiempo real.

Luego, el administrador analiza la información recopilada en un **dashboard analítico**, que aplica técnicas de minería de datos y de texto para obtener hallazgos, patrones e insights.

**Objetivo principal:** reducir la ambigüedad y aumentar la cobertura en la fase de levantamiento de requisitos, anclando cada requisito a una actividad concreta del proceso de negocio.

---

# 2. Roles de usuario

| Rol | Descripción | Permisos principales |
|-----|-------------|----------------------|
| **Administrador** | Responsable del proyecto de levantamiento (analista o docente). | Crear proyectos, subir diagramas, configurar el canvas, invitar participantes, moderar detalles, ver el dashboard, exportar resultados. |
| **Participante** | Stakeholder, usuario final o estudiante. | Acceder a los proyectos invitados, navegar el canvas, crear, editar y eliminar **sus** detalles, comentar y votar detalles de otros. |

---

# 3. Requisitos funcionales

## RF-01 Autenticación y gestión de usuarios
- Registro e inicio de sesión con email y contraseña (hash con bcrypt o argon2).
- Autenticación con JWT (access token de corta duración + refresh token en cookie `httpOnly`).
- Invitación de participantes a un proyecto por enlace o por email.
- Autorización basada en roles (RBAC) a nivel de proyecto.

## RF-02 Gestión de proyectos y diagramas
- CRUD de proyectos (nombre, descripción, estado: borrador / abierto / cerrado).
- Un proyecto puede contener uno o varios diagramas de actividades (versionados).
- Subida de imágenes en PNG, JPG o SVG (máx. 10 MB), con validación de tipo MIME y tamaño.
- Cerrar un proyecto impide nuevos aportes, pero mantiene la lectura.

## RF-03 Conversión de la imagen en espacio de trabajo
El sistema transforma la imagen subida en un canvas interactivo:
1. La imagen se carga como **capa base** (textura) del canvas.
2. **Detección asistida de actividades:** el sistema propone automáticamente las regiones que corresponden a actividades, decisiones, nodos inicial y final, y el texto de cada una:
   - Detección de formas (rectángulos redondeados, rombos, círculos) con OpenCV.
   - Extracción del texto de cada nodo mediante OCR (Tesseract) o un modelo de visión (LLM multimodal).
   - Detección opcional de las flechas o transiciones para reconstruir el flujo (grafo).
3. **Validación manual por el administrador:** puede aceptar, corregir, crear, redimensionar o eliminar las regiones (hotspots) y editar el nombre de cada actividad antes de publicar el espacio de trabajo.
4. El resultado se guarda como un **modelo estructurado** (nodos + transiciones + coordenadas), no solo como una imagen.

## RF-04 Canvas interactivo (three.js)
- Renderizado con **three.js** usando una cámara ortográfica (vista 2D) sobre un plano con la textura del diagrama.
- Navegación: zoom con la rueda del ratón o pinch, desplazamiento (pan) arrastrando, botón "ajustar a pantalla" y minimapa.
- Hotspots de actividades como meshes seleccionables (raycasting), con resaltado al pasar el cursor.
- Indicadores visuales por actividad: número de detalles, un mapa de calor según la cantidad de aportes y un badge "sin detalles" para las actividades sin cobertura.
- Notas adhesivas (sticky notes) visibles junto a cada actividad, que se pueden expandir o colapsar.
- Soporte para escritorio y tablet; en móvil, solo lectura.

## RF-05 Registro de detalles de requisitos
Al seleccionar una actividad se abre un panel lateral con los detalles existentes y un formulario para agregar uno nuevo:

| Campo | Descripción | Obligatorio |
|-------|-------------|-------------|
| **Dado (Qué / contexto)** | Situación o precondición en la que ocurre la actividad. | Sí |
| **Cuando (acción)** | Acción o evento que realiza el usuario o el sistema. | Sí |
| **Entonces (resultado)** | Resultado esperado u observable. | Sí |
| Tipo | Funcional / No funcional / Regla de negocio / Restricción | Sí |
| Prioridad | MoSCoW (Must, Should, Could, Won't) | No |
| Rol del autor | Rol del stakeholder que aporta (p. ej., cliente, operador) | No |
| Etiquetas | Texto libre | No |

- Varios usuarios pueden agregar detalles a la misma actividad.
- Los demás participantes pueden **votar** (+1) y **comentar** cada detalle.
- Historial de cambios de cada detalle (auditoría: quién y cuándo).
- El administrador puede marcar los detalles como *validado*, *duplicado* o *descartado*.

## RF-06 Colaboración en tiempo real
- Sincronización en tiempo real con **WebSockets (Socket.IO)**: los detalles, votos y comentarios nuevos aparecen sin recargar la página.
- Presencia: lista de usuarios conectados y cursores en vivo, con nombre y color.
- Resolución de conflictos: gana la última escritura para los detalles, con bloqueo optimista mediante un campo `version`.

## RF-07 Dashboard analítico (solo administrador)
Procesa los detalles con técnicas de **minería de datos y de texto** (en español):

**Preprocesamiento:** normalización, tokenización, eliminación de stopwords y lematización (spaCy `es_core_news_md`).

**Análisis descriptivo**
- KPIs: total de detalles, participantes activos y porcentaje de actividades cubiertas.
- Distribución por actividad, tipo, prioridad y rol.
- Actividad en el tiempo (serie temporal de aportes).
- Mapa de calor de cobertura sobre el propio diagrama.

**Minería de texto**
- Palabras y frases clave por actividad (TF-IDF, n-gramas).
- Nube de palabras y red de coocurrencia de términos.
- **Modelado de temas** (LDA o BERTopic) para descubrir necesidades transversales.
- **Clustering semántico** de detalles con embeddings (sentence-transformers multilingüe + HDBSCAN o K-Means) para agrupar requisitos similares.
- **Detección de duplicados o casi duplicados** mediante similitud coseno sobre los embeddings.
- **Análisis de sentimiento** para detectar dolores o frustraciones del usuario.
- **Calidad del requisito:** detección de términos ambiguos ("rápido", "fácil", "amigable", "etc.") y de escenarios incompletos, con un puntaje de calidad por detalle.

**Minería de datos**
- Reglas de asociación (Apriori) entre etiquetas, tipos y actividades.
- Detección de actividades "calientes" (alto volumen o conflicto) y "frías" (sin cobertura).

**Insights automáticos**
- Un resumen en lenguaje natural de los hallazgos principales, generado con un LLM a partir de los resultados del análisis.
- Recomendaciones, por ejemplo: "La actividad *Validar pago* concentra el 30 % de los requisitos no funcionales; revisar requisitos de seguridad".

**Exportación:** requisitos en CSV/Excel y reporte en PDF; los escenarios también en formato `.feature` (Gherkin).

- El análisis se ejecuta de forma **asíncrona** (bajo demanda o programado) y sus resultados se guardan en caché en MongoDB.

---

# 4. Requisitos no funcionales

| ID | Categoría | Requisito |
|----|-----------|-----------|
| RNF-01 | Rendimiento | El canvas mantiene ≥ 50 FPS con diagramas de hasta 100 actividades y 2 000 detalles. |
| RNF-02 | Tiempo real | Latencia de propagación de eventos < 500 ms (p95). |
| RNF-03 | Seguridad | OWASP Top 10: validación de entradas (zod), sanitización de texto (XSS), rate limiting, CORS restringido, Helmet y secretos en variables de entorno. |
| RNF-04 | Escalabilidad | Servicios stateless, escalables horizontalmente. |
| RNF-05 | Usabilidad | Interfaz en español, responsiva y con accesibilidad WCAG 2.1 AA en los formularios y paneles. |
| RNF-06 | Disponibilidad | Healthchecks (`/health`) en cada servicio y reinicio automático. |
| RNF-07 | Observabilidad | Logs estructurados (pino) y trazabilidad por `requestId`. |
| RNF-08 | Calidad | Cobertura de pruebas ≥ 70 % en backend y servicio analítico. |

---

# 5. Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | React + TypeScript + Vite, **three.js** (vía `@react-three/fiber` y `@react-three/drei`), Zustand, TanStack Query, Tailwind CSS, Recharts o ECharts para el dashboard. |
| Backend API | Node.js 24 LTS + TypeScript, Fastify (o Express), Socket.IO, Mongoose, zod. |
| Servicio analítico | Python 3.12 + FastAPI, spaCy, scikit-learn, sentence-transformers, BERTopic, OpenCV, Tesseract/pytesseract. |
| Base de datos | **MongoDB** (Railway MongoDB o MongoDB Atlas). |
| Colas / caché | Redis (adapter de Socket.IO para múltiples instancias + cola de trabajos con BullMQ). |
| Almacenamiento de archivos | Almacenamiento compatible con S3 (Railway Bucket o Cloudflare R2); Railway Volume como alternativa. |
| Pruebas | Vitest, Supertest, Playwright (E2E), pytest. |
| Calidad | ESLint, Prettier, Ruff, Husky + lint-staged, commitlint. |

---

# 6. Arquitectura y despliegue en Railway

## 6.1 Servicios

```
                ┌────────────────────┐
  Usuario ───▶  │  web (frontend)    │  React + three.js (build estático servido por Caddy/Nginx)
                └─────────┬──────────┘
                          │ HTTPS / WSS
                ┌─────────▼──────────┐        ┌───────────────────┐
                │  api (Node.js)     │◀──────▶│  redis            │  pub/sub Socket.IO + colas
                │  REST + Socket.IO  │        └─────────▲─────────┘
                └───┬──────────┬─────┘                  │
                    │          │  jobs                  │
          ┌─────────▼───┐   ┌──▼─────────────────────────┴──┐
          │  mongodb    │◀──│  analytics (Python/FastAPI)   │  OCR, detección, NLP, ML
          └─────────────┘   └───────────────────────────────┘
                    │
          ┌─────────▼───────────┐
          │  bucket S3 (imágenes)│
          └─────────────────────┘
```

- Un **proyecto de Railway** con los servicios `web`, `api`, `analytics`, `mongodb` y `redis`.
- Comunicación interna entre servicios por la **red privada de Railway** (`*.railway.internal`); solo `web` y `api` exponen dominio público.
- Cada servicio tiene su propio `Dockerfile` (multi-stage) y un `railway.json` o `railway.toml` con el healthcheck y la política de reinicio.
- Variables de entorno gestionadas en Railway con referencias entre servicios (p. ej., `MONGO_URL=${{mongodb.MONGO_URL}}`).
- Entornos de Railway: `production` y `staging`, además de entornos efímeros por Pull Request.

## 6.2 Estructura del repositorio (monorepo con pnpm workspaces)

```
/
├── apps/
│   ├── web/            # Frontend React + three.js
│   ├── api/            # Backend Node.js
│   └── analytics/      # Servicio Python
├── packages/
│   └── shared/         # Tipos TS y esquemas zod compartidos
├── infra/              # docker-compose para desarrollo local
├── docs/               # ADRs, diagramas, manual de usuario
└── .github/workflows/  # CI/CD
```

## 6.3 Modelo de datos (MongoDB)

- `users` { _id, name, email, passwordHash, createdAt }
- `projects` { _id, name, description, status, ownerId, members: [{ userId, role }] }
- `diagrams` { _id, projectId, version, imageUrl, width, height, status: draft|published }
- `activities` { _id, diagramId, label, type: action|decision|start|end, bbox: {x,y,w,h}, next: [activityId] }
- `details` { _id, activityId, projectId, authorId, given, when, then, type, priority, tags[], status, votes[], version, createdAt, updatedAt }
- `comments` { _id, detailId, authorId, text, createdAt }
- `audit_logs` { _id, entity, entityId, action, userId, diff, at }
- `analysis_runs` { _id, projectId, status, startedAt, finishedAt, results }

Índices en `details.activityId`, `details.projectId` y en un índice de texto sobre `given/when/then`.

---

# 7. CI/CD (GitHub Actions + Railway)

Los despliegues se ejecutan **solo desde GitHub Actions** con la Railway CLI (`railway up --ci`) y un project token por entorno; el autodeploy de Railway queda desactivado.

**Pipeline en cada Pull Request:**
1. Instalar dependencias con caché (pnpm y pip).
2. Lint y verificación de formato (ESLint, Prettier, Ruff).
3. Verificación de tipos (`tsc --noEmit`, mypy).
4. Pruebas unitarias y de integración (con MongoDB y Redis como services del job).
5. Build de los tres servicios y build de las imágenes Docker.
6. Pruebas E2E con Playwright sobre docker-compose.
7. Validación de mensajes de commit (commitlint).
8. Despliegue en el entorno efímero de Railway para el PR.

**Pipeline en `main`:**
1. Repetir las validaciones anteriores.
2. Desplegar automáticamente en `staging` desde GitHub Actions.
3. Ejecutar smoke tests contra `staging`.
4. Promover a `production` con aprobación manual (GitHub Environments) usando `railway up` con `RAILWAY_TOKEN`.
5. Crear un tag semántico y un changelog automático (release-please).

**Rollback:** redeploy del deployment anterior en Railway o `git revert` del commit problemático.

---

# 8. Convenciones de control de versiones

- **Commits atómicos:** cada commit contiene un único cambio lógico, compila y pasa las pruebas por sí solo.
- **Commits reversibles:** cualquier commit puede revertirse con `git revert` sin romper `main`. Las migraciones de datos tienen `up` y `down` (migrate-mongo), y las funcionalidades incompletas quedan detrás de *feature flags*.
- **Conventional Commits:** `feat(canvas): ...`, `fix(api): ...`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`.
- **Flujo de ramas:** trunk-based, con ramas cortas `feat/*` y `fix/*`, PR obligatorio con CI en verde y squash desactivado para conservar los commits atómicos.
- Documentar las decisiones de arquitectura como ADR en `docs/adr/`.

---

# 9. Plan de implementación por fases

| Fase | Entregable |
|------|------------|
| 0. Fundaciones | Monorepo, linters, docker-compose, CI básico, proyecto en Railway con los servicios vacíos y healthchecks. |
| 1. Autenticación y proyectos | Registro/login, RBAC, CRUD de proyectos e invitaciones. |
| 2. Diagramas y canvas | Subida de imágenes, canvas three.js con zoom/pan y edición manual de hotspots. |
| 3. Detalles de requisitos | Formulario Dado/Cuando/Entonces, panel lateral, votos, comentarios y auditoría. |
| 4. Tiempo real | Socket.IO, presencia, cursores y adapter Redis. |
| 5. Detección asistida | OCR y detección de formas en el servicio analítico, con propuesta de hotspots. |
| 6. Dashboard analítico | Métricas descriptivas, NLP, clustering, temas, duplicados, calidad e insights con LLM. |
| 7. Exportación y cierre | CSV, PDF y Gherkin; pruebas E2E, documentación y despliegue a producción. |

---

# 10. Criterios de aceptación globales

- El administrador sube un diagrama, valida las actividades detectadas y publica el espacio de trabajo en menos de 5 minutos.
- Dos o más participantes agregan detalles a la misma actividad y cada uno ve los aportes de los demás en tiempo real.
- El dashboard muestra al menos: cobertura por actividad, temas, clusters, duplicados, puntaje de calidad y un resumen de insights.
- El despliegue en Railway se realiza automáticamente desde `main`, y cada servicio responde `200` en `/health`.
- El historial de git muestra commits atómicos con formato Conventional Commits.

---

# 11. Fuera de alcance (versión 1)

- Edición del diagrama UML en sí (dibujar o modificar nodos y flechas sobre la imagen).
- Otros tipos de diagramas UML (casos de uso, secuencia, clases).
- Integración con Jira, Azure DevOps u otras herramientas de gestión.
- Aplicación móvil nativa.

---

# 12. Entregables

1. Código fuente en el monorepo con su README de instalación y ejecución local.
2. Aplicación desplegada en Railway (URL de staging y de producción).
3. Pipelines de CI/CD funcionales.
4. Documentación: arquitectura, ADRs, modelo de datos, API (OpenAPI/Swagger) y manual de usuario.
5. Suite de pruebas automatizadas con reporte de cobertura.
