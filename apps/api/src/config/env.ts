import { z } from 'zod';

/** Variables de entorno de la API (specs/001-plataforma-base/contracts/env-vars.md). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  HOST: z.string().default('::'),
  MONGO_URL: z.url(),
  MONGO_DB: z.string().min(1),
  REDIS_URL: z.url(),
  ANALYTICS_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FEATURE_FLAGS: z.string().optional(),
  GIT_SHA: z.string().default('unknown'),
  APP_VERSION: z.string().default('dev'),
  // Sesión (feature 002, research R1 y R11).
  JWT_SECRET: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32),
  /** Duración del access token en formato `<n><s|m|h|d>`, p. ej. `15m`. */
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+[smhd]$/)
    .default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** URL pública de `web`; base de los enlaces de invitación. */
  APP_BASE_URL: z.url(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Error de configuración: nombra las variables afectadas, nunca sus valores. */
export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Configuración inválida o incompleta. Revisa las variables: ${variables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Una variable vacía cuenta como ausente.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(variables);
  }
  return result.data;
}
