import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrations';
import { auditLogsModel } from '../../src/modules/audit/model';
import { auditService } from '../../src/modules/audit/service';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const dbName = uniqueDbName('audit');
let connection: Connection;

beforeAll(async () => {
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  connection = await mongoose.createConnection(MONGO_TEST_URL, { dbName }).asPromise();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('servicio de auditoría (FR-013)', () => {
  it('registra la acción con actor, proyecto, entidad, diff y fecha', async () => {
    const actorId = new mongoose.Types.ObjectId();
    const projectId = new mongoose.Types.ObjectId();
    await auditService(connection).record('project.status_changed', {
      actorId,
      projectId,
      entity: { type: 'project', id: projectId.toHexString() },
      diff: { status: { from: 'draft', to: 'open' } },
    });

    const [log] = await auditLogsModel(connection).find({ projectId }).lean();
    expect(log).toMatchObject({
      action: 'project.status_changed',
      actorId,
      entity: { type: 'project', id: projectId.toHexString() },
      diff: { status: { from: 'draft', to: 'open' } },
    });
    expect(log?.at).toBeInstanceOf(Date);
  });

  it('acepta eventos anónimos (sin actor ni proyecto)', async () => {
    await auditService(connection).record('auth.login_failed', {
      entity: { type: 'user', id: 'email-hash' },
    });
    const log = await auditLogsModel(connection).findOne({ action: 'auth.login_failed' }).lean();
    expect(log?.actorId).toBeUndefined();
    expect(log?.projectId).toBeUndefined();
  });

  it('nunca guarda secretos en diff, tampoco anidados', async () => {
    const projectId = new mongoose.Types.ObjectId();
    await auditService(connection).record('invitation.created', {
      projectId,
      entity: { type: 'invitation', id: 'i1' },
      diff: {
        expiresAt: '2026-10-07',
        token: 's3cret-token',
        nested: { passwordHash: 's3cret-hash', refreshToken: 's3cret-rt', keep: 'ok' },
        list: [{ apiSecret: 's3cret-list', name: 'visible' }],
      },
    });

    const log = await auditLogsModel(connection).findOne({ projectId }).lean();
    expect(JSON.stringify(log)).not.toMatch(/s3cret/);
    expect(log?.diff).toEqual({
      expiresAt: '2026-10-07',
      nested: { keep: 'ok' },
      list: [{ name: 'visible' }],
    });
  });

  it('si la auditoría falla, lo registra en el log y no interrumpe la operación', async () => {
    vi.spyOn(auditLogsModel(connection), 'create').mockRejectedValueOnce(new Error('sin conexión'));
    const warnings: unknown[] = [];
    await expect(
      auditService(connection, { warn: (...args) => warnings.push(args) }).record(
        'member.removed',
        { entity: { type: 'member', id: 'u1' } },
      ),
    ).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).toContain('member.removed');
  });
});
