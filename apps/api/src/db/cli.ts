// CLI de migraciones: `migrate up|down|status`. En Railway se ejecuta como preDeployCommand.
import { migrationsStatus, runMigrations } from './migrations.js';

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
  } else if (command === 'status') {
    for (const item of await migrationsStatus({ url, dbName })) {
      console.log(`${item.fileName}\t${item.appliedAt === 'PENDING' ? 'PENDING' : 'APPLIED'}`);
    }
  } else {
    log('fatal', 'Uso: migrate up|down|status');
    process.exit(1);
  }
} catch (error) {
  log('fatal', (error as Error).message);
  process.exit(1);
}
