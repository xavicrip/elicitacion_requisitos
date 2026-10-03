import type { Writable } from 'node:stream';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { registerErrorHandlers } from './lib/errors.js';
import { loadFlags } from './lib/flags.js';
import { analysisSchedulePlugin } from './jobs/analysis-schedule.js';
import { analysisPlugin, type AnalysisConfig } from './jobs/analysis.js';
import { detectionPlugin, type DetectionConfig } from './jobs/detection.js';
import { projectDeletionPlugin } from './jobs/project-deletion.js';
import { authRoutes } from './modules/auth/routes.js';
import { activityRoutes } from './modules/diagrams/activities.routes.js';
import { analysisRoutes } from './modules/dashboard/analysis.routes.js';
import { registerDashboardCascade } from './modules/dashboard/cascade.js';
import { decisionRoutes } from './modules/dashboard/decisions.routes.js';
import { descriptiveRoutes } from './modules/dashboard/descriptive.routes.js';
import { registerDetailsCascade } from './modules/details/cascade.js';
import { registerDetectionCascade } from './modules/detection/cascade.js';
import { commentRoutes } from './modules/details/comments.routes.js';
import { coverageRoutes } from './modules/details/coverage.routes.js';
import { detailAuditPlugin } from './modules/details/events.js';
import { detailRoutes } from './modules/details/routes.js';
import { voteRoutes } from './modules/details/votes.routes.js';
import { registerDiagramsCascade } from './modules/diagrams/cascade.js';
import { activityDependentsPlugin } from './modules/diagrams/dependents.js';
import { publishGuardsPlugin } from './modules/diagrams/publish-guards.js';
import { detectionRoutes } from './modules/detection/routes.js';
import { imageRoutes } from './modules/diagrams/image.routes.js';
import { diagramRoutes } from './modules/diagrams/routes.js';
import { invitationRoutes } from './modules/invitations/routes.js';
import { memberRoutes } from './modules/projects/member-routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { authPlugin } from './plugins/auth.js';
import { authorizationPlugin } from './plugins/authorization.js';
import { featureGatePlugin } from './plugins/flags.js';
import { domainEventsPlugin } from './lib/domain-events.js';
import { realtimePlugin, type RealtimeConfig } from './realtime/server.js';
import { mongoPlugin } from './plugins/mongo.js';
import { genReqId, observability, REDACT_PATHS } from './plugins/observability.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { redisPlugin } from './plugins/redis.js';
import { storagePlugin } from './plugins/storage.js';
import { healthRoutes } from './routes/health.js';

export type ServicesConfig = {
  mongoUrl: string;
  mongoDb: string;
  redisUrl: string;
  analyticsUrl: string;
  version: string;
  commit: string;
  featureFlags: string | undefined;
  /** Timeout de cada check de salud (2 s por defecto). */
  checkTimeoutMs?: number;
  /** Autenticación, proyectos e invitaciones (feature 002). Sin ella no se montan sus rutas. */
  auth?: AuthConfig;
  /** Job de borrado de proyectos (feature 002, research R9). */
  deletion?: DeletionConfig;
  /** Bucket S3 de las imágenes de diagramas (feature 003). */
  storage?: StorageConfig;
  /** Colaboración en tiempo real (feature 005): tiempos y prefijos para las pruebas. */
  realtime?: RealtimeConfig;
  /** Detección asistida (feature 006): prefijos y tiempos para las pruebas. */
  detection?: DetectionConfig;
  /** Análisis del dashboard (feature 007), solo con el flag `dashboard`. */
  analysis?: AnalysisConfig;
};

export type { AnalysisConfig, DetectionConfig, RealtimeConfig };

export type StorageConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Crear el bucket al arrancar si no existe (solo local y CI). */
  createBucket: boolean;
};

export type DeletionConfig = {
  /** Reintentos del job (por defecto 5, con espera exponencial desde `backoffMs`). */
  attempts?: number;
  backoffMs?: number;
  /** Prefijo de las colas en Redis; las pruebas usan uno propio. */
  queuePrefix?: string;
};

export type AuthConfig = {
  jwtSecret: string;
  /** `JWT_ACCESS_TTL`, p. ej. `15m`. */
  accessTtl: string;
  refreshTtlDays: number;
  /** Cookie `rt` con `Secure`; `false` solo en desarrollo (Compose sirve por http). */
  secureCookies: boolean;
  /** Prefijo de las claves de Redis (rate limit y bloqueo); las pruebas usan uno propio. */
  redisNameSpace?: string;
  /** `APP_BASE_URL`: URL pública de web, base de los enlaces de invitación. */
  appBaseUrl: string;
};

export type BuildAppOptions = {
  logLevel?: string;
  /** Destino de los logs (por defecto stdout); las pruebas lo usan para inspeccionarlos. */
  logStream?: Writable;
  /** Orígenes permitidos por CORS (`CORS_ORIGINS`); vacío = ningún origen cruzado. */
  corsOrigins?: string[];
  /** Dependencias externas. Sin ellas solo se montan los plugins transversales. */
  services?: ServicesConfig;
};

// Mensajes de validación en español (constitución VI).
z.config(z.locales.es());

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[redactado]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    requestIdHeader: false,
    genReqId,
  });

  // Esquemas zod de `@reqcanvas/shared` para validar entradas y serializar respuestas.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  await app.register(observability);
  await app.register(helmet);
  await app.register(cors, { origin: options.corsOrigins ?? [], credentials: true });

  const services = options.services;
  if (services) {
    const checkTimeoutMs = services.checkTimeoutMs ?? 2000;
    const flags = loadFlags(services.featureFlags, (message) => app.log.warn(message));
    await app.register(featureGatePlugin, { flags });
    await app.register(mongoPlugin, {
      url: services.mongoUrl,
      dbName: services.mongoDb,
      timeoutMs: checkTimeoutMs,
    });
    await app.register(redisPlugin, { url: services.redisUrl, timeoutMs: checkTimeoutMs });
    await app.register(domainEventsPlugin);
    if (services.storage) await app.register(storagePlugin, services.storage);
    await app.register(healthRoutes, {
      analyticsUrl: services.analyticsUrl,
      version: services.version,
      commit: services.commit,
      checkTimeoutMs,
      flags,
    });

    if (services.auth) {
      const { jwtSecret, accessTtl, redisNameSpace = '' } = services.auth;
      await app.register(authPlugin, { secret: jwtSecret, accessTtl });
      await app.register(rateLimitPlugin, { nameSpace: `${redisNameSpace}rate-limit:` });
      await app.register(authorizationPlugin);
      await app.register(authRoutes, { ...services.auth, redisNameSpace });
      await app.register(projectDeletionPlugin, {
        redisUrl: services.redisUrl,
        ...services.deletion,
      });
      await app.register(projectRoutes);
      await app.register(memberRoutes);
      await app.register(invitationRoutes, { appBaseUrl: services.auth.appBaseUrl });

      // Diagramas (feature 003): requieren el bucket de las imágenes.
      if (services.storage) {
        await app.register(activityDependentsPlugin);
        await app.register(publishGuardsPlugin);
        await app.register(diagramRoutes);
        await app.register(imageRoutes);
        await app.register(activityRoutes);
        registerDiagramsCascade(app);

        // Detalles de requisitos (feature 004).
        await app.register(detailAuditPlugin);
        registerDetailsCascade(app);
        await app.register(detailRoutes);
        await app.register(coverageRoutes);
        await app.register(voteRoutes);
        await app.register(commentRoutes);

        // Dashboard analítico (feature 007): la cascada existe aunque el flag esté desactivado.
        registerDashboardCascade(app);
        if (flags.dashboard) {
          await app.register(descriptiveRoutes);
          await app.register(analysisPlugin, {
            redisUrl: services.redisUrl,
            queuePrefix: `${redisNameSpace}bull`,
            keyPrefix: redisNameSpace,
            ...services.analysis,
          });
          await app.register(analysisSchedulePlugin, {
            redisUrl: services.redisUrl,
            queuePrefix: services.analysis?.queuePrefix ?? `${redisNameSpace}bull`,
          });
          await app.register(analysisRoutes);
          await app.register(decisionRoutes);
        }

        // Detección asistida (feature 006): cola con analytics-worker.
        registerDetectionCascade(app);
        await app.register(detectionPlugin, {
          redisUrl: services.redisUrl,
          queuePrefix: `${redisNameSpace}bull`,
          keyPrefix: redisNameSpace,
          ...services.detection,
        });
        await app.register(detectionRoutes);

        // Colaboración en tiempo real (feature 005): Socket.IO atiende /socket.io/ fuera del
        // router (plan de la 005, ajuste 2).
        await app.register(realtimePlugin, {
          adapterKey: `${redisNameSpace}socket.io`,
          keyPrefix: redisNameSpace,
          ...services.realtime,
        });
      }
    }
  }

  return app;
}
