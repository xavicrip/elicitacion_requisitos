import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations';
import { commentsModel } from '../../src/modules/details/models/comment';
import { detailsModel } from '../../src/modules/details/models/detail';
import { historyModel } from '../../src/modules/details/models/history';
import { votesModel } from '../../src/modules/details/models/vote';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const dbName = uniqueDbName('details_models');
let connection: Connection;
const id = () => new mongoose.Types.ObjectId();
const scenario = {
  given: ' el cliente tiene productos ',
  when: 'paga con tarjeta',
  then: 'el sistema confirma el pago',
  type: 'non_functional' as const,
};

beforeAll(async () => {
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  connection = await mongoose.createConnection(MONGO_TEST_URL, { dbName }).asPromise();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('modelos de la feature 004', () => {
  it('un detalle nuevo está pendiente, con contadores y rev a 0 y los textos recortados', async () => {
    const detail = await detailsModel(connection).create({
      projectId: id(),
      diagramId: id(),
      activityKey: '0b1f5c7e-7d9a-4c0e-9d6c-2f1e3a4b5c6d',
      authorId: id(),
      ...scenario,
    });
    expect(detail.toJSON()).toMatchObject({
      given: 'el cliente tiene productos',
      status: 'pending',
      priority: null,
      authorRole: null,
      tags: [],
      duplicateOf: null,
      discardReason: null,
      voteCount: 0,
      commentCount: 0,
      rev: 0,
    });
  });

  it('un detalle sin uno de los tres componentes no se guarda (constitución I)', async () => {
    const { then: _then, ...withoutThen } = scenario;
    await expect(
      detailsModel(connection).create({
        projectId: id(),
        diagramId: id(),
        activityKey: 'k',
        authorId: id(),
        ...withoutThen,
      }),
    ).rejects.toThrow(/then/);
  });

  it('votos y comentarios guardan su fecha de creación; el historial es inmutable', async () => {
    const vote = await votesModel(connection).create({
      detailId: id(),
      userId: id(),
      projectId: id(),
    });
    expect(vote.createdAt).toBeInstanceOf(Date);
    expect(vote.toObject()).not.toHaveProperty('updatedAt');

    const comment = await commentsModel(connection).create({
      detailId: id(),
      projectId: id(),
      authorId: id(),
      text: ' ¿Aplica a PayPal? ',
    });
    expect(comment.toJSON()).toMatchObject({ text: '¿Aplica a PayPal?', editedAt: null });

    const entry = await historyModel(connection).create({
      detailId: id(),
      projectId: id(),
      rev: 0,
      snapshot: { then: 'antes' },
      change: 'edit',
      editedBy: id(),
    });
    expect(entry.editedAt).toBeInstanceOf(Date);
    expect(entry.toObject()).not.toHaveProperty('updatedAt');
  });

  it('Mongoose no crea índices propios: solo los de las migraciones', async () => {
    const names = (await connection.collection('detail_votes').indexes()).map((i) => i.name);
    expect(names.sort()).toEqual(['_id_', 'detailId_userId_unique', 'projectId']);
  });
});
