import type { LoginInput, RegisterInput, Session, SessionUser } from '@reqcanvas/shared';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import type { AuthConfig } from '../../app.js';
import { HttpError } from '../../lib/errors.js';
import { auditService } from '../audit/service.js';
import { usersModel, type User } from '../users/model.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { refreshTokensModel } from './refresh-token.model.js';
import { hashToken, newRefreshToken, newSessionId, refreshExpiry, ttlToSeconds } from './tokens.js';

/** Intentos fallidos permitidos y duración del bloqueo (FR-004, research R4). */
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;
/** Margen en el que reutilizar un refresh recién rotado se trata como carrera entre pestañas. */
const REUSE_GRACE_MS = 10_000;

const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
const sessionExpired = () =>
  new HttpError(401, 'SESSION_EXPIRED', 'Tu sesión ha caducado. Inicia sesión de nuevo.');

export type IssuedSession = { session: Session; refreshToken: string };

function toSessionUser(user: Pick<User, '_id' | 'name' | 'email'>): SessionUser {
  return { id: user._id.toHexString(), name: user.name, email: user.email };
}

export function authService(app: FastifyInstance, config: AuthConfig) {
  const Users = usersModel(app.mongo);
  const Tokens = refreshTokensModel(app.mongo);
  const audit = auditService(app.mongo, app.log);
  const accessTtlSeconds = ttlToSeconds(config.accessTtl);
  const ns = config.redisNameSpace ?? '';

  // Hash de referencia para que un email inexistente cueste lo mismo que uno real (R5).
  let dummyHash: Promise<string> | undefined;
  const dummy = () => (dummyHash ??= hashPassword('contraseña-ficticia-para-igualar-tiempos'));

  async function issueSession(
    user: Pick<User, '_id' | 'name' | 'email'>,
    sid = newSessionId(),
  ): Promise<IssuedSession> {
    const { token, hash } = newRefreshToken();
    await Tokens.create({
      userId: user._id,
      sid,
      tokenHash: hash,
      expiresAt: refreshExpiry(config.refreshTtlDays),
    });
    return {
      refreshToken: token,
      session: {
        accessToken: app.signAccessToken(user._id.toHexString(), sid),
        expiresIn: accessTtlSeconds,
        user: toSessionUser(user),
      },
    };
  }

  async function revokeFamily(sid: string): Promise<void> {
    await Tokens.updateMany({ sid, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  // --- Bloqueo por intentos fallidos (Redis). Si Redis no responde, no se bloquea: el rate
  // limit por IP tampoco lo hace (plugins/rate-limit.ts).
  const failureKeys = (email: string, ip: string) => [
    `${ns}login:fail:email:${hashToken(email)}`,
    `${ns}login:fail:ip:${ip}`,
  ];

  async function lockedFor(keys: string[]): Promise<number> {
    try {
      const counts = await app.redis.mget(...keys);
      const locked = keys.filter((_key, i) => Number(counts[i] ?? 0) >= MAX_FAILURES);
      if (locked.length === 0) return 0;
      const ttls = await Promise.all(locked.map((key) => app.redis.ttl(key)));
      return Math.max(...ttls, 1);
    } catch {
      return 0;
    }
  }

  async function recordFailure(keys: string[]): Promise<void> {
    try {
      for (const key of keys) {
        const count = await app.redis.incr(key);
        // La ventana empieza en el primer fallo; al bloquear, el bloqueo dura 15 min completos.
        if (count === 1 || count >= MAX_FAILURES) await app.redis.expire(key, LOCK_SECONDS);
      }
    } catch {
      app.log.warn('No se pudo registrar el intento fallido en Redis');
    }
  }

  return {
    async register(input: RegisterInput): Promise<IssuedSession> {
      const policy = checkPasswordPolicy(input.password);
      if (!policy.ok) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'Revisa los datos del formulario.',
          {},
          {
            password: policy.message,
          },
        );
      }
      const duplicate = () =>
        new HttpError(409, 'REGISTRATION_FAILED', 'No se pudo crear la cuenta con esos datos');
      if (await Users.exists({ email: input.email })) {
        // Mismo trabajo que un registro real: la respuesta no revela que el email existe.
        await hashPassword(input.password);
        throw duplicate();
      }
      try {
        const user = await Users.create({
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
        });
        return await issueSession(user);
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw duplicate();
        throw error;
      }
    },

    async login(input: LoginInput, ip: string): Promise<IssuedSession> {
      const keys = failureKeys(input.email, ip);
      const retryAfter = await lockedFor(keys);
      if (retryAfter > 0) {
        throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos, espera 15 minutos', {
          'retry-after': String(retryAfter),
        });
      }

      const user = await Users.findOne({ email: input.email }).select('+passwordHash');
      const ok = user
        ? await verifyPassword(user.passwordHash, input.password)
        : (await verifyPassword(await dummy(), input.password), false);

      if (!user || !ok) {
        await recordFailure(keys);
        await audit.record('auth.login_failed', {
          // Solo el hash del email: la auditoría no guarda datos personales de intentos anónimos.
          entity: { type: 'user', id: hashToken(input.email) },
          actorId: user?._id,
        });
        throw invalidCredentials();
      }

      await app.redis.del(keys[0]!).catch(() => 0);
      await Users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
      return issueSession(user);
    },

    async refresh(token: string | undefined): Promise<IssuedSession> {
      if (!token) throw sessionExpired();
      const now = new Date();
      const current = await Tokens.findOne({ tokenHash: hashToken(token) }).lean();
      if (!current || current.revokedAt || current.expiresAt <= now) throw sessionExpired();

      if (current.rotatedAt) {
        // Reutilizar un token ya rotado: carrera entre pestañas si es inmediato; si no, robo.
        if (now.getTime() - current.rotatedAt.getTime() > REUSE_GRACE_MS) {
          await revokeFamily(current.sid);
          await audit.record('auth.refresh_reused', {
            actorId: current.userId as Types.ObjectId,
            entity: { type: 'session', id: current.sid },
          });
        }
        throw sessionExpired();
      }

      const rotated = await Tokens.findOneAndUpdate(
        { _id: current._id, rotatedAt: null, revokedAt: null },
        { $set: { rotatedAt: now } },
      );
      // Otra petición lo rotó en paralelo: misma respuesta que la carrera entre pestañas.
      if (!rotated) throw sessionExpired();

      const user = await Users.findById(current.userId);
      if (!user) throw sessionExpired();
      return issueSession(user, current.sid);
    },

    async logout(token: string | undefined): Promise<void> {
      if (!token) return;
      const current = await Tokens.findOne({ tokenHash: hashToken(token) }).lean();
      if (current) await revokeFamily(current.sid);
    },

    async me(userId: string): Promise<SessionUser> {
      const user = await Users.findById(userId);
      if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Inicia sesión para continuar.');
      return toSessionUser(user);
    },
  };
}
