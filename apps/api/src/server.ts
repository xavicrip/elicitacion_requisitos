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

const app = await buildApp({
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS,
  services: {
    mongoUrl: env.MONGO_URL,
    mongoDb: env.MONGO_DB,
    redisUrl: env.REDIS_URL,
    analyticsUrl: env.ANALYTICS_URL,
    version: env.APP_VERSION,
    commit: env.GIT_SHA,
    featureFlags: env.FEATURE_FLAGS,
    auth: {
      jwtSecret: env.JWT_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtlDays: env.REFRESH_TTL_DAYS,
      secureCookies: env.NODE_ENV !== 'development',
      appBaseUrl: env.APP_BASE_URL,
    },
    storage: {
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      createBucket: env.S3_CREATE_BUCKET,
    },
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'cerrando');
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
