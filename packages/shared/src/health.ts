import { z } from 'zod';

/** Estado de una dependencia de un servicio (Mongo, Redis, analytics…). */
export const HealthCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().min(0),
  /** Mensaje sin datos sensibles. */
  error: z.string().optional(),
});

/** Respuesta de GET /health y GET /health/deep (contracts/health.openapi.yaml). */
export const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.enum(['api', 'analytics', 'web']),
  version: z.string(),
  commit: z.string(),
  checks: z.record(z.string(), HealthCheckSchema),
  timestamp: z.iso.datetime(),
});

export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type ServiceName = Health['service'];

/** `ok` solo si todos los checks están en `up`. */
export function overallStatus(checks: Record<string, HealthCheck>): Health['status'] {
  return Object.values(checks).every((check) => check.status === 'up') ? 'ok' : 'degraded';
}
