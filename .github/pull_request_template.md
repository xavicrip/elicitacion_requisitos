## Qué cambia

<!-- Resumen breve. Si corresponde a una feature de spec-kit, enlaza la spec: specs/NNN-nombre/spec.md -->

## Tareas

<!-- IDs de tasks.md que cubre este PR, p. ej. T028–T034 -->

## Checklist de la constitución

- [ ] **Commits atómicos** (Principio IV): cada commit es un único cambio lógico, compila y pasa las pruebas por sí solo; formato Conventional Commits.
- [ ] **Pruebas primero** (Principio III): las pruebas nuevas se vieron fallar antes de implementar y van en el mismo commit que su implementación.
- [ ] **Cobertura** ≥ 70 % en `api` y `analytics` (lo verifica el CI).
- [ ] **Contratos**: los cambios de API/eventos actualizan `packages/shared` y el contrato en `specs/`; los cambios son aditivos (las eliminaciones van en un PR posterior).
- [ ] **Migraciones**: tienen `up` y `down`; si alguna es destructiva, declara `destructive: true`.
- [ ] **Seguridad**: sin secretos en el código; autorización verificada en el servidor; entradas validadas.
- [ ] **Funcionalidad incompleta** detrás de un feature flag.

## Cómo probarlo

<!-- Pasos o sección de quickstart.md -->
