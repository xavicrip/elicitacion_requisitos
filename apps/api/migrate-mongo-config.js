// Configuración de la CLI de migrate-mongo; solo se usa para `pnpm migrate:create <nombre>`.
// Aplicar o revertir migraciones se hace con `src/db/cli.ts` (lock propio, ver migration-config.ts).
export default {
  mongodb: {
    url: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
    databaseName: process.env.MONGO_DB ?? 'reqcanvas',
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  lockTtl: 0,
  migrationFileExtension: '.js',
  moduleSystem: 'esm',
};
