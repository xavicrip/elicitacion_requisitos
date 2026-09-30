import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityDependentsPlugin, type ActivityRef } from '../../src/modules/diagrams/dependents';
import { buildTestApp, closeTestApp } from '../helpers/app';

let app: FastifyInstance;
const ref = (key: string): ActivityRef => ({
  projectId: new Types.ObjectId(),
  versionId: new Types.ObjectId(),
  activityId: new Types.ObjectId(),
  key,
});

beforeAll(async () => {
  ({ app } = await buildTestApp('dependents'));
  await app.register(activityDependentsPlugin);
});

afterAll(() => closeTestApp(app));

describe('registro de dependientes de actividades (lo usa la 004 para los requisitos)', () => {
  it('sin registros, el conteo es 0 y remove no hace nada', async () => {
    await app.ready();
    expect(await app.activityDependents.count(ref('k1'))).toEqual({ total: 0, byName: {} });
    await expect(app.activityDependents.remove(ref('k1'))).resolves.toBeUndefined();
  });

  it('suma los conteos de cada dependiente y los elimina todos', async () => {
    const store: Record<string, string[]> = { requirements: ['k2', 'k2', 'k3'], votes: ['k2'] };
    for (const name of Object.keys(store)) {
      app.registerActivityDependents(name, {
        count: async ({ key }) => store[name]!.filter((k) => k === key).length,
        remove: async ({ key }) => {
          store[name] = store[name]!.filter((k) => k !== key);
        },
      });
    }

    expect(await app.activityDependents.count(ref('k2'))).toEqual({
      total: 3,
      byName: { requirements: 2, votes: 1 },
    });
    await app.activityDependents.remove(ref('k2'));
    expect(await app.activityDependents.count(ref('k2'))).toEqual({
      total: 0,
      byName: { requirements: 0, votes: 0 },
    });
    expect(store.requirements).toEqual(['k3']);
  });

  it('un nombre duplicado es un error de programación', () => {
    const handler = { count: async () => 0, remove: async () => {} };
    expect(() => app.registerActivityDependents('requirements', handler)).toThrow(/duplicado/);
  });
});
