<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/001-plataforma-base/plan.md
<!-- SPECKIT END -->

## Comandos del proyecto

- Entorno local: `pnpm install`, `(cd apps/analytics && uv sync)`, `pnpm dev:up` / `pnpm dev:down`
- Calidad: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`
- Pruebas de integración fuera de CI: definir `MONGO_TEST_URL`, `REDIS_TEST_URL` y `S3_TEST_URL` (RustFS: `docker run -p 9000:9000 -e RUSTFS_ACCESS_KEY=rustfsadmin -e RUSTFS_SECRET_KEY=rustfsadmin rustfs/rustfs:1.0.0`)
- Migraciones: `pnpm --filter @reqcanvas/api migrate:up|down|status|create`
- Despliegue: solo por GitHub Actions (`deploy.yml`, `release.yml`); rollback con `scripts/rollback.sh` (sin `railway ssh`: `MIGRATION_ACTION`, ver ADR 0003)
- Commits: Conventional Commits con alcance; una prueba y su implementación van en el mismo commit
