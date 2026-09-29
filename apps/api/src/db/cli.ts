// CLI de migraciones: `migrate up|down|status|auto`. En Railway, `auto` es el preDeployCommand.
import { s3BackupStore, s3SettingsFromEnv } from './backup.js';
import {
  migrationsStatus,
  parseMigrationAction,
  runDeployMigrations,
  runMigrations,
} from './migrations.js';

const command = process.argv[2];
const url = process.env.MONGO_URL;
const dbName = process.env.MONGO_DB;

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, ...extra }));
}

if (!url || !dbName) {
  const variables = ['MONGO_URL', 'MONGO_DB'].filter((name) => !process.env[name]);
  log('fatal', 'Configuración de migraciones incompleta', { variables });
  process.exit(1);
}

try {
  if (command === 'up' || command === 'down') {
    const files = await runMigrations(command, { url, dbName });
    log('info', `migraciones ${command}`, { files });
  } else if (command === 'auto') {
    // Acción según MIGRATION_ACTION; respalda en el bucket antes de migraciones destructivas.
    const s3 = s3SettingsFromEnv(process.env);
    if ('missing' in s3 && s3.missing.length < 4) {
      log('warn', 'Bucket de respaldos configurado a medias', { variables: s3.missing });
    }
    const result = await runDeployMigrations(
      { url, dbName },
      {
        action: parseMigrationAction(process.env.MIGRATION_ACTION),
        store: 'settings' in s3 ? s3BackupStore(s3.settings) : undefined,
        version: process.env.APP_VERSION ?? 'dev',
        log: (msg, extra) => log('info', msg, extra),
      },
    );
    log('info', 'migraciones del despliegue', result);
  } else if (command === 'status') {
    for (const item of await migrationsStatus({ url, dbName })) {
      console.log(`${item.fileName}\t${item.appliedAt === 'PENDING' ? 'PENDING' : 'APPLIED'}`);
    }
  } else {
    log('fatal', 'Uso: migrate up|down|status|auto');
    process.exit(1);
  }
} catch (error) {
  log('fatal', (error as Error).message);
  process.exit(1);
}
