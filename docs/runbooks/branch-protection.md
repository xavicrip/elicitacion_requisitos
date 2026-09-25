# Runbook: protección de la rama `main`

Aplica los requisitos FR-007 y SC-005 de la feature 001 y el Principio IV de la constitución.

## Qué se configura

| Ajuste                         | Valor                                                                                                                                                  | Por qué                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Métodos de merge               | Solo **Rebase and merge**                                                                                                                              | Conserva los commits atómicos y evita los commits "Merge pull request #…", que no siguen Conventional Commits (SC-005). commitlint ignora los merge commits por defecto, así que esta regla es la que lo garantiza. |
| Historial lineal               | Obligatorio                                                                                                                                            | Igual que el anterior; además, `git revert` y `git bisect` funcionan commit a commit.                                                                                                                               |
| Checks obligatorios            | `lint`, `typecheck`, `commitlint`, `secrets`, `test-node`, `test-python`, `migrations`, `build (api)`, `build (analytics)`, `build (web)`, `e2e-smoke` | FR-006 y FR-007: no se integra nada con el CI en rojo. `strict` exige que el PR esté al día con `main`.                                                                                                             |
| Revisiones                     | 1 aprobación; se descartan las aprobaciones obsoletas                                                                                                  | Revisión de cumplimiento de la constitución.                                                                                                                                                                        |
| Conversaciones                 | Deben resolverse antes del merge                                                                                                                       |                                                                                                                                                                                                                     |
| Force push / borrado de `main` | Prohibidos                                                                                                                                             |                                                                                                                                                                                                                     |
| Borrar la rama tras el merge   | Activado                                                                                                                                               |                                                                                                                                                                                                                     |

`enforce_admins` queda en `false`: con un único mantenedor, GitHub no permite aprobar tu propio
PR, así que el administrador necesita poder integrar sin la revisión. Cuando haya un segundo
revisor, cambiarlo a `true`.

## Cómo aplicarlo

Requiere `gh` autenticado con permisos de administrador del repositorio y que el workflow
`ci` se haya ejecutado al menos una vez (para que existan los nombres de los checks).

```bash
scripts/github/protect-main.sh                 # repositorio actual
scripts/github/protect-main.sh owner/repo      # otro repositorio
```

El script es idempotente: se puede volver a ejecutar tras cambiar la lista de checks.

## Verificación

```bash
gh api repos/{owner}/{repo}/branches/main/protection --jq '{linear: .required_linear_history.enabled, checks: .required_status_checks.contexts}'
gh api repos/{owner}/{repo} --jq '{merge: .allow_merge_commit, squash: .allow_squash_merge, rebase: .allow_rebase_merge}'
```

## Ramas apiladas (features de spec-kit)

Las ramas `NNN-nombre` se apilan según el roadmap (`specs/README.md`). Integra siempre hacia
`main`, en orden: primero `001`, después la siguiente con `git rebase --update-refs main`
y un PR con destino `main`.
