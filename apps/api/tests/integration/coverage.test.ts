import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detailsModel } from '../../src/modules/details/models/detail';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadVersion } from '../helpers/diagrams';
import { createDetail, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US3: cobertura por actividad para los indicadores del canvas (research R6–R8).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;

beforeAll(async () => {
  ({ app } = await buildTestApp('coverage', { withAuth: true }));
  await app.ready();
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
});

afterAll(() => closeTestApp(app));

const as = (user: TestUser) => authHeaders(user);

async function setup() {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  return { projectId, ...(await publishedDiagram(app, as(ana), projectId)) };
}

const coverage = async (versionId: string, user = ana) =>
  (
    await app.inject({ url: `/diagram-versions/${versionId}/coverage`, headers: as(user) })
  ).json() as Array<{
    activityKey: string;
    total: number;
    byStatus: Record<string, number>;
    effectiveVotes: number;
    top: Array<{ id: string; summary: string }>;
  }>;

const setDetail = (id: string, fields: Record<string, unknown>) =>
  detailsModel(app.mongo).updateOne({ _id: id }, { $set: fields });

describe('cobertura de una versión', () => {
  it('devuelve todas las actividades de la versión, también las que no tienen detalles', async () => {
    const { versionId, keys } = await setup();
    const result = await coverage(versionId);
    expect(result.map((entry) => entry.activityKey)).toEqual(Object.values(keys));
    expect(result.every((entry) => entry.total === 0 && entry.top.length === 0)).toBe(true);
  });

  it('total excluye descartados y duplicados; byStatus los cuenta todos', async () => {
    const { versionId, diagramId, keys } = await setup();
    const key = keys['Validar pago']!;
    const ids = [];
    for (let i = 0; i < 4; i++)
      ids.push((await createDetail(app, as(luis), diagramId, key)).json().id);
    await setDetail(ids[1], { status: 'validated' });
    await setDetail(ids[2], { status: 'discarded', discardReason: 'Fuera de alcance' });
    await setDetail(ids[3], { status: 'duplicate', duplicateOf: new Types.ObjectId(ids[0]) });
    const entry = (await coverage(versionId)).find((item) => item.activityKey === key)!;
    expect(entry.total).toBe(2);
    expect(entry.byStatus).toEqual({ pending: 1, validated: 1, duplicate: 1, discarded: 1 });
  });

  it('effectiveVotes suma los votos de los duplicados al original (research R6)', async () => {
    const { versionId, diagramId, keys } = await setup();
    const key = keys['Validar pago']!;
    const original = (await createDetail(app, as(luis), diagramId, key)).json().id;
    const other = (await createDetail(app, as(luis), diagramId, keys['Emitir factura']!)).json().id;
    await setDetail(original, { voteCount: 2 });
    // El duplicado está en otra actividad: sus votos cuentan para la del original.
    await setDetail(other, {
      voteCount: 3,
      status: 'duplicate',
      duplicateOf: new Types.ObjectId(original),
    });
    const result = await coverage(versionId);
    expect(result.find((item) => item.activityKey === key)).toMatchObject({
      total: 1,
      effectiveVotes: 5,
    });
    expect(result.find((item) => item.activityKey === keys['Emitir factura'])).toMatchObject({
      total: 0,
      effectiveVotes: 0,
    });
  });

  it('top: hasta 3 resúmenes «Cuando … → Entonces …» de ≤ 80 caracteres, por votos (research R8)', async () => {
    const { versionId, diagramId, keys } = await setup();
    const key = keys['Validar pago']!;
    const created = [];
    for (const [index, then] of ['uno', 'dos', 'tres', 'cuatro'].entries()) {
      const id = (
        await createDetail(app, as(luis), diagramId, key, {
          when: 'paga con tarjeta',
          then: `${then} ${'x'.repeat(index * 30)}`,
        })
      ).json().id;
      await setDetail(id, { voteCount: index });
      created.push(id);
    }
    const { top } = (await coverage(versionId)).find((item) => item.activityKey === key)!;
    expect(top.map((item) => item.id)).toEqual([created[3], created[2], created[1]]);
    expect(top.every((item) => item.summary.startsWith('Cuando paga con tarjeta → Entonces'))).toBe(
      true,
    );
    expect(top.every((item) => item.summary.length <= 80)).toBe(true);
  });

  it('solo cuenta las claves de la versión consultada, no los huérfanos', async () => {
    const { versionId, diagramId, keys } = await setup();
    await createDetail(app, as(luis), diagramId, keys['Validar pago']!);
    // Un detalle huérfano: su key ya no está en ninguna versión.
    await detailsModel(app.mongo).updateOne(
      { diagramId },
      { $set: { activityKey: crypto.randomUUID() } },
    );
    const result = await coverage(versionId);
    expect(result).toHaveLength(3);
    expect(result.every((entry) => entry.total === 0)).toBe(true);
  });

  it('un Participante solo consulta versiones publicadas; quien no es miembro, 404', async () => {
    const { diagramId, versionId } = await setup();
    const draft = (await uploadVersion(app, as(ana), diagramId)).json();
    expect(
      (await app.inject({ url: `/diagram-versions/${draft.id}/coverage`, headers: as(luis) }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/diagram-versions/${draft.id}/coverage`, headers: as(ana) }))
        .statusCode,
    ).toBe(200);
    const outsider = await registerTestUser(app, 'Olga');
    expect(
      (await app.inject({ url: `/diagram-versions/${versionId}/coverage`, headers: as(outsider) }))
        .statusCode,
    ).toBe(404);
  });
});
