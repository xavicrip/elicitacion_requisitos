import { buildApp } from './app.js';
import { ConfigError, loadEnv, type Env } from './config/env.js';

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  if (error instanceof ConfigError) {
    // Log estructurado mínimo: el logger de la app aún no existe.
    console.error(
      JSON.stringify({ level: 'fatal', msg: error.message, variables: error.variables }),
    );
    process.exit(1);
  }
  throw error;
}

const app = await buildApp({ logLevel: env.LOG_LEVEL });
await app.listen({ port: env.PORT, host: env.HOST });
