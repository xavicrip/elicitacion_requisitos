import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    /** Aviso si `maxmemory-policy` no es `noeviction` (lo muestra `/health/deep`). */
    redisPolicyWarning?: string;
    /** Comprobación de la política en curso, lanzada al conectar (las pruebas la esperan). */
    redisPolicyCheck?: Promise<void>;
  }
}

type RedisOptions = { url: string; timeoutMs: number };

type PolicyResult = { ok: boolean; policy: string; warning?: string };

/**
 * BullMQ exige `maxmemory-policy noeviction`: con otra política, Redis podría expulsar claves
 * de las colas (plan de la 002, ajuste 7). Algunos Redis gestionados bloquean `CONFIG`; en ese
 * caso no se puede comprobar y no se considera un fallo.
 */
export async function checkEvictionPolicy(redis: {
  config: (...args: ['GET', string]) => Promise<unknown>;
}): Promise<PolicyResult> {
  try {
    const reply = (await redis.config('GET', 'maxmemory-policy')) as string[];
    const policy = reply[1] ?? 'desconocida';
    return policy === 'noeviction'
      ? { ok: true, policy }
      : { ok: false, policy, warning: `maxmemory-policy es ${policy}; BullMQ requiere noeviction` };
  } catch {
    return { ok: true, policy: 'desconocida' };
  }
}

/** Cliente Redis compartido; como Mongo, no bloquea el arranque si Redis no responde. */
export const redisPlugin = fp<RedisOptions>(
  async (app, { url, timeoutMs }) => {
    const redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: timeoutMs,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    let warned = false;
    redis.on('error', (error: Error) => {
      if (!warned) app.log.warn({ err: { name: error.name } }, 'Redis no disponible');
      warned = true;
    });
    redis.on('ready', () => {
      warned = false;
      app.redisPolicyCheck = checkEvictionPolicy(redis).then((result) => {
        app.redisPolicyWarning = result.warning;
        if (result.warning) app.log.error({ policy: result.policy }, result.warning);
        else if (result.policy === 'desconocida') {
          app.log.warn('No se pudo comprobar maxmemory-policy de Redis (CONFIG no disponible)');
        }
      });
    });
    redis.connect().catch(() => {});
    app.decorate('redis', redis);
    app.decorate('redisPolicyWarning', undefined);
    app.decorate('redisPolicyCheck', undefined);
    app.addHook('onClose', async () => {
      redis.disconnect();
    });
  },
  { name: 'redis' },
);
