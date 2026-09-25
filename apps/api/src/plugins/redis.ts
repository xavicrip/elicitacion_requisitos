import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

type RedisOptions = { url: string; timeoutMs: number };

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
    });
    redis.connect().catch(() => {});
    app.decorate('redis', redis);
    app.addHook('onClose', async () => {
      redis.disconnect();
    });
  },
  { name: 'redis' },
);
