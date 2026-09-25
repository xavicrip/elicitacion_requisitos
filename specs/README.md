# ReqCanvas — Roadmap de implementación (spec-kit)

Fuente: [`prompt.md`](../prompt.md) · Constitución: [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) (v1.1.0)

## Features

Cada feature vive en **su propia rama** (`NNN-nombre`), con su spec, su plan y (en la 001)
sus tareas. Las ramas se apilan según las dependencias: cada una parte de la rama de la
feature de la que depende, por lo que contiene también los documentos de sus antecesoras.

| # | Rama | Feature | Cubre (prompt.md) | Parte de | Estado |
|---|------|---------|-------------------|----------|--------|
| 001 | `001-plataforma-base` | Plataforma base y entrega continua | §6, §7, §8, Fase 0 | `main` | spec ✅ · plan ✅ · tasks ✅ |
| 002 | `002-auth-proyectos` | Autenticación, roles y proyectos | RF-01, RF-02, §2 | `001-plataforma-base` | spec ✅ · plan ✅ |
| 003 | `003-diagramas-canvas` | Diagramas y espacio de trabajo interactivo | RF-02, RF-03 (manual), RF-04 | `002-auth-proyectos` | spec ✅ · plan ✅ |
| 004 | `004-detalles-requisitos` | Detalles de requisitos por actividad | RF-04 (indicadores), RF-05 | `003-diagramas-canvas` | spec ✅ · plan ✅ |
| 005 | `005-colaboracion-tiempo-real` | Colaboración en tiempo real | RF-06, RNF-02 | `004-detalles-requisitos` | spec ✅ · plan ✅ |
| 006 | `006-deteccion-asistida` | Detección asistida de actividades | RF-03 (automático) | `003-diagramas-canvas` | spec ✅ · plan ✅ |
| 007 | `007-dashboard-analitico` | Dashboard analítico | RF-07 | `004-detalles-requisitos` | spec ✅ · plan ✅ |
| 008 | `008-exportacion-resultados` | Exportación de resultados | RF-07 (exportación) | `007-dashboard-analitico` | spec ✅ · plan ✅ |

Para leer una feature: `git switch NNN-nombre` y abrir `specs/NNN-nombre/`.

## Decisiones transversales

- **Node.js 24 LTS** en `web`, `api`, `packages/shared` y en CI.
- **Despliegue solo desde GitHub Actions** (`railway up --ci` con project token por entorno);
  autodeploy de Railway desactivado; producción con aprobación manual.

## Orden y paralelismo

```text
001 ──▶ 002 ──▶ 003 ──┬──▶ 004 ──┬──▶ 005
                      │          └──▶ 007 ──▶ 008
                      └──▶ 006
```

- **Camino crítico (MVP de valor)**: 001 → 002 → 003 → 004. Con eso, un administrador sube un
  diagrama, marca las actividades y los participantes registran requisitos Dado/Cuando/Entonces.
- **En paralelo tras 003**: 006 (detección, con el servicio `analytics`) puede avanzar a la vez que 004.
- **En paralelo tras 004**: 005 (tiempo real) y 007 (dashboard) son independientes entre sí.
- **008** cierra la v1; parte de 007 porque el reporte PDF usa los resultados del dashboard.

## Hitos sugeridos

| Hito | Features | Resultado demostrable |
|------|----------|------------------------|
| M0 — Fundaciones | 001 | Pipeline verde, staging y producción en Railway con `/health` |
| M1 — MVP colaborativo | 002, 003, 004 | Levantamiento completo sin tiempo real ni analítica |
| M2 — Pizarra en vivo | 005, 006 | Experiencia tipo Miro/Mural y preparación rápida de diagramas |
| M3 — Inteligencia | 007, 008 | Dashboard con minería de texto, insights y exportación |

## Flujo por feature

Para cada feature, en orden:

1. `git switch NNN-nombre` (la rama ya existe con su spec y su plan).
2. Comprobar que `.specify/feature.json` apunta a `specs/NNN-nombre`.
3. `/speckit-tasks` → `tasks.md` (con pruebas obligatorias según la constitución).
4. `/speckit-analyze` → consistencia entre spec, plan y tareas.
5. `/speckit-implement` → implementación con commits atómicos.
6. PR de la rama a `main`; al integrarla, hacer `git rebase --update-refs main` en las ramas
   que dependen de ella.

Para una feature nueva: `/speckit-git-feature` crea la rama y `/speckit-specify` la spec.
