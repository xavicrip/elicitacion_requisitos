# ReqCanvas — Roadmap de implementación (spec-kit)

Fuente: [`prompt.md`](../prompt.md) · Constitución: [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) (v1.0.0)

## Features

| # | Feature | Cubre (prompt.md) | Historias (prioridad) | Depende de | Estado |
|---|---------|-------------------|------------------------|------------|--------|
| 001 | [Plataforma base y entrega continua](./001-plataforma-base/spec.md) | §6, §7, §8, Fase 0 | 4 (P1, P1, P2, P3) | — | spec ✅ · plan ✅ · tasks ✅ |
| 002 | [Autenticación, roles y proyectos](./002-auth-proyectos/spec.md) | RF-01, RF-02, §2 | 4 (P1, P1, P2, P1) | 001 | spec ✅ |
| 003 | [Diagramas y espacio de trabajo interactivo](./003-diagramas-canvas/spec.md) | RF-02, RF-03 (manual), RF-04 | 4 (P1 ×4) | 002 | spec ✅ |
| 004 | [Detalles de requisitos por actividad](./004-detalles-requisitos/spec.md) | RF-04 (indicadores), RF-05 | 5 (P1, P1, P2, P2, P3) | 003 | spec ✅ |
| 005 | [Colaboración en tiempo real](./005-colaboracion-tiempo-real/spec.md) | RF-06, RNF-02 | 4 (P1, P2, P3, P2) | 004 | spec ✅ |
| 006 | [Detección asistida de actividades](./006-deteccion-asistida/spec.md) | RF-03 (automático) | 3 (P1, P1, P3) | 003 | spec ✅ |
| 007 | [Dashboard analítico](./007-dashboard-analitico/spec.md) | RF-07 | 5 (P1, P1, P2, P2, P3) | 004 | spec ✅ |
| 008 | [Exportación de resultados](./008-exportacion-resultados/spec.md) | RF-07 (exportación) | 3 (P1, P2, P2) | 004, 007 | spec ✅ |

## Orden y paralelismo

```text
001 ──▶ 002 ──▶ 003 ──┬──▶ 004 ──┬──▶ 005
                      │          ├──▶ 007 ──▶ 008
                      └──▶ 006   │
                                 └──▶ 008 (CSV/Gherkin no requieren 007)
```

- **Camino crítico (MVP de valor)**: 001 → 002 → 003 → 004. Con eso, un administrador sube un
  diagrama, marca las actividades y los participantes registran requisitos Dado/Cuando/Entonces.
- **En paralelo tras 003**: 006 (detección, con el servicio `analytics`) puede avanzar a la vez que 004.
- **En paralelo tras 004**: 005 (tiempo real) y 007 (dashboard) son independientes entre sí.
- **008** cierra la v1: CSV y Gherkin solo necesitan 004; el PDF necesita 007.

## Hitos sugeridos

| Hito | Features | Resultado demostrable |
|------|----------|------------------------|
| M0 — Fundaciones | 001 | Pipeline verde, staging y producción en Railway con `/health` |
| M1 — MVP colaborativo | 002, 003, 004 | Levantamiento completo sin tiempo real ni analítica |
| M2 — Pizarra en vivo | 005, 006 | Experiencia tipo Miro/Mural y preparación rápida de diagramas |
| M3 — Inteligencia | 007, 008 | Dashboard con minería de texto, insights y exportación |

## Flujo por feature

Para cada feature, en orden:

1. `/speckit-git-feature` → crea la rama `NNN-nombre` desde `main`.
2. Fijar la feature en `.specify/feature.json` (`"feature_directory": "specs/NNN-nombre"`).
3. `/speckit-clarify` (opcional) → resolver ambigüedades de la spec.
4. `/speckit-plan` → `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`.
5. `/speckit-tasks` → `tasks.md` (con pruebas obligatorias según la constitución).
6. `/speckit-analyze` → consistencia entre spec, plan y tareas.
7. `/speckit-implement` → implementación con commits atómicos; PR a `main`.

> Las features 002–008 tienen solo la spec: su plan técnico se genera al empezar cada una,
> para que refleje el código real construido en las features anteriores.
