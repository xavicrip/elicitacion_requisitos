import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations';
import { auditLogsModel } from '../../src/modules/audit/model';
import { projectsModel } from '../../src/modules/projects/model';
import { usersModel } from '../../src/modules/users/model';
import { MONGO_TEST_URL, uniqueDbName } from '../helpers/services';

const dbName = uniqueDbName('models');
let connection: Connection;

beforeAll(async () => {
  await runMigrations('up', { url: MONGO_TEST_URL, dbName });
  connection = await mongoose.createConnection(MONGO_TEST_URL, { dbName }).asPromise();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('modelos de la feature 002', () => {
  it('passwordHash no se lee por defecto ni se serializa (constitución V)', async () => {
    const Users = usersModel(connection);
    const created = await Users.create({
      name: 'Ana',
      email: 'ANA@Example.com',
      passwordHash: 'hash-argon2id',
    });
    expect(created.email).toBe('ana@example.com');
    expect(JSON.stringify(created)).not.toContain('hash-argon2id');

    const found = await Users.findById(created._id);
    expect(found?.passwordHash).toBeUndefined();
    const withHash = await Users.findById(created._id).select('+passwordHash');
    expect(withHash?.passwordHash).toBe('hash-argon2id');
  });

  it('un proyecto nuevo empieza en draft con su última actividad', async () => {
    const owner = new mongoose.Types.ObjectId();
    const project = await projectsModel(connection).create({
      name: '  Tienda  ',
      ownerId: owner,
      members: [{ userId: owner, role: 'admin', joinedAt: new Date() }],
    });
    expect(project).toMatchObject({ name: 'Tienda', status: 'draft', description: '' });
    expect(project.lastActivityAt).toBeInstanceOf(Date);
    expect(project.deletion).toBeUndefined();
  });

  it('el registro de auditoría es inmutable: sin updatedAt', async () => {
    const log = await auditLogsModel(connection).create({
      action: 'auth.login_failed',
      entity: { type: 'user', id: 'desconocido' },
    });
    expect(log.at).toBeInstanceOf(Date);
    expect(log.toObject()).not.toHaveProperty('updatedAt');
  });

  it('Mongoose no crea índices propios: solo los de las migraciones', async () => {
    const names = (await connection.collection('users').indexes()).map((index) => index.name);
    expect(names.sort()).toEqual(['_id_', 'email_unique']);
  });

  it('un modelo se registra una sola vez por conexión', () => {
    expect(usersModel(connection)).toBe(usersModel(connection));
  });
});
