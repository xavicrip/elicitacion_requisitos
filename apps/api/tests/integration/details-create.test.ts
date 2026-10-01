import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogsModel } from '../../src/modules/audit/model';
import { detailsModel } from '../../src/modules/details/models/detail';
import { votesModel } from '../../src/modules/details/models/vote';
import { projectsModel } from '../../src/modules/projects/model';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { uploadDiagram } from '../helpers/diagrams';
import { createDetail, detailsUrl, publishedDiagram } from '../helpers/details';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// US1: registrar detalles en una actividad (FR-001–FR-004, constitución I).

let app: FastifyInstance;
let ana: TestUser;
let luis: TestUser;
let marta: TestUser;
const events: string[] = [];

beforeAll(async () => {
  ({ app } = await buildTestApp('detailscreate', {
    withAuth: true,
    logStream: new Writable({ write: (_c, _e, done) => done() }),
  }));
  await app.ready();
  app.detailEvents.onAny((name) => void events.push(name));
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  marta = await registerTestUser(app, 'Marta');
});

afterAll(() => closeTestApp(app));

const as = (user: TestUser) => authHeaders(user);

async function setup(status: 'draft' | 'open' | 'closed' = 'open') {
  const projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
      [marta, 'participant'],
    ],
  });
  const diagram = await publishedDiagram(app, as(ana), projectId);
  if (status !== 'open') {
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status } });
  }
  return { projectId, ...diagram, key: diagram.keys['Validar pago']! };
}

describe('crear un detalle', () => {
  it('un Participante registra un detalle completo, con su nombre y la fecha', async () => {
    const { diagramId, key } = await setup();
    const response = await createDetail(app, as(luis), diagramId, key, {
      priority: 'must',
      authorRole: 'Cajero',
      tags: ['Pagos', 'pagos ', 'Tarjeta'],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      activityKey: key,
      priority: 'must',
      authorRole: 'Cajero',
      tags: ['pagos', 'tarjeta'],
      status: 'pending',
      author: { id: luis.id, name: luis.name },
      permissions: { canEdit: true, canDelete: true, canVote: false, canModerate: false },
    });
  });

  it.each(['given', 'when', 'then'])(
    'sin %s → 400 que indica el campo (constitución I)',
    async (field) => {
      const { diagramId, key } = await setup();
      const response = await createDetail(app, as(luis), diagramId, key, { [field]: '  ' });
      expect(response.statusCode).toBe(400);
      expect(response.json().fields).toHaveProperty(field);
    },
  );

  it('una activityKey que no está en la versión publicada → 404', async () => {
    const { diagramId } = await setup();
    const response = await createDetail(app, as(luis), diagramId, crypto.randomUUID());
    expect(response.statusCode).toBe(404);
  });

  it('un diagrama sin versión publicada → 404 (también para el Administrador)', async () => {
    const { projectId } = await setup();
    const draft = (await uploadDiagram(app, as(ana), projectId, { name: 'Borrador' })).json();
    const activity = (
      await app.inject({
        method: 'POST',
        url: `/diagram-versions/${draft.id}/activities`,
        headers: as(ana),
        payload: { label: 'A', type: 'action', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
      })
    ).json();
    const response = await createDetail(app, as(ana), draft.diagramId, activity.key);
    expect(response.statusCode).toBe(404);
  });

  it.each(['closed', 'draft'] as const)(
    'en un proyecto %s → 409 PROJECT_NOT_OPEN',
    async (status) => {
      const { diagramId, key } = await setup(status);
      const response = await createDetail(app, as(luis), diagramId, key);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'PROJECT_NOT_OPEN' });
    },
  );

  it('quien no es miembro recibe 404; el Administrador también registra detalles', async () => {
    const { diagramId, key } = await setup();
    const outsider = await registerTestUser(app, 'Olga');
    expect((await createDetail(app, as(outsider), diagramId, key)).statusCode).toBe(404);
    expect((await createDetail(app, as(ana), diagramId, key)).statusCode).toBe(201);
  });

  it('el texto con HTML se guarda y se devuelve literal', async () => {
    const { diagramId, key } = await setup();
    const html = '<script>alert(1)</script> el cliente';
    const response = await createDetail(app, as(luis), diagramId, key, { given: html });
    expect(response.json().given).toBe(html);
  });

  it('actualiza lastActivityAt, audita detail.created y emite el evento', async () => {
    const { projectId, diagramId, key } = await setup();
    const before = new Date();
    const { id } = (await createDetail(app, as(luis), diagramId, key)).json();
    const project = await projectsModel(app.mongo).findById(projectId);
    expect(project!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(
      await auditLogsModel(app.mongo).findOne({ action: 'detail.created', 'entity.id': id }),
    ).toMatchObject({ actorId: new Types.ObjectId(luis.id) });
    expect(events).toContain('detail.created');
  });

  it('limita las escrituras a 60 por minuto y usuario (429)', async () => {
    const { diagramId, key } = await setup();
    const sprinter = await registerTestUser(app, 'Rápido');
    await projectsModel(app.mongo).updateMany(
      {},
      {
        $push: {
          members: {
            userId: new Types.ObjectId(sprinter.id),
            role: 'participant',
            joinedAt: new Date(),
          },
        },
      },
    );
    const responses = [];
    for (let i = 0; i < 61; i++)
      responses.push((await createDetail(app, as(sprinter), diagramId, key)).statusCode);
    expect(responses.slice(0, 60).every((code) => code === 201)).toBe(true);
    expect(responses[60]).toBe(429);
  });
});

describe('listar los detalles de una actividad', () => {
  it('ordena por votos efectivos (incluidos los de sus duplicados) y luego por fecha', async () => {
    const { diagramId, key } = await setup();
    const first = (
      await createDetail(app, as(luis), diagramId, key, { then: 'el primero en llegar' })
    ).json();
    const voted = (
      await createDetail(app, as(marta), diagramId, key, { then: 'el más votado' })
    ).json();
    const newest = (
      await createDetail(app, as(luis), diagramId, key, { then: 'el más reciente' })
    ).json();
    await detailsModel(app.mongo).updateOne({ _id: voted.id }, { $set: { voteCount: 2 } });
    // Un duplicado de "first" con 3 votos: los suma al original (research R6).
    const duplicate = (
      await createDetail(app, as(marta), diagramId, key, { then: 'duplicado' })
    ).json();
    await detailsModel(app.mongo).updateOne(
      { _id: duplicate.id },
      { $set: { status: 'duplicate', duplicateOf: new Types.ObjectId(first.id), voteCount: 3 } },
    );

    const list = (await app.inject({ url: detailsUrl(diagramId, key), headers: as(marta) })).json();
    expect(list.map((d: { id: string }) => d.id)).toEqual([
      duplicate.id,
      first.id,
      voted.id,
      newest.id,
    ]);

    const recent = (
      await app.inject({ url: detailsUrl(diagramId, key, '?sort=recent'), headers: as(marta) })
    ).json();
    expect(recent[0].id).toBe(duplicate.id);
    expect(recent.map((d: { id: string }) => d.id).indexOf(newest.id)).toBe(1);
  });

  it('filtra por estado, tipo, prioridad y etiqueta (FR-012)', async () => {
    const { diagramId, key } = await setup();
    await createDetail(app, as(luis), diagramId, key, {
      type: 'functional',
      priority: 'must',
      tags: ['pagos'],
    });
    await createDetail(app, as(luis), diagramId, key, { type: 'constraint', tags: ['legal'] });
    const filter = async (query: string) =>
      (await app.inject({ url: detailsUrl(diagramId, key, query), headers: as(luis) })).json()
        .length;
    expect(await filter('?type=functional')).toBe(1);
    expect(await filter('?priority=must')).toBe(1);
    expect(await filter('?tag=Legal')).toBe(1);
    expect(await filter('?status=pending')).toBe(2);
    expect(await filter('?status=validated')).toBe(0);
  });

  it('votedByMe y permissions dependen de quien consulta', async () => {
    const { projectId, diagramId, key } = await setup();
    const detail = (await createDetail(app, as(luis), diagramId, key)).json();
    await votesModel(app.mongo).create({
      detailId: new Types.ObjectId(detail.id),
      userId: new Types.ObjectId(marta.id),
      projectId: new Types.ObjectId(projectId),
    });
    const [forMarta] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(marta) })
    ).json();
    expect(forMarta).toMatchObject({
      votedByMe: true,
      permissions: { canEdit: false, canDelete: false, canVote: true, canModerate: false },
    });
    const [forAna] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(ana) })
    ).json();
    expect(forAna.permissions).toEqual({
      canEdit: true,
      canDelete: true,
      canVote: true,
      canModerate: true,
    });
  });

  it('en un proyecto cerrado se ven los detalles, pero nadie puede escribir', async () => {
    const { projectId, diagramId, key } = await setup();
    await createDetail(app, as(luis), diagramId, key);
    await projectsModel(app.mongo).updateOne({ _id: projectId }, { $set: { status: 'closed' } });
    const [detail] = (
      await app.inject({ url: detailsUrl(diagramId, key), headers: as(luis) })
    ).json();
    expect(detail.permissions).toEqual({
      canEdit: false,
      canDelete: false,
      canVote: false,
      canModerate: false,
    });
  });
});

describe('facets (sugerencias de rol y etiquetas, FR-003)', () => {
  it('devuelve los roles y etiquetas usados en el proyecto con su frecuencia', async () => {
    const { projectId, diagramId, key } = await setup();
    await createDetail(app, as(luis), diagramId, key, { authorRole: 'Cajero', tags: ['pagos'] });
    await createDetail(app, as(marta), diagramId, key, {
      authorRole: 'Cajero',
      tags: ['pagos', 'legal'],
    });
    const facets = (
      await app.inject({ url: `/projects/${projectId}/details/facets`, headers: as(marta) })
    ).json();
    expect(facets).toEqual({
      roles: [{ value: 'Cajero', count: 2 }],
      tags: [
        { value: 'pagos', count: 2 },
        { value: 'legal', count: 1 },
      ],
    });
  });
});
