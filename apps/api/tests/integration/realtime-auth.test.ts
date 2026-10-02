import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp } from '../helpers/app';
import { publishedDiagram } from '../helpers/details';
import { uploadDiagram } from '../helpers/diagrams';
import {
  closeSockets,
  connect,
  disconnected,
  pause,
  tryHandshake,
  type ClientSocket,
} from '../helpers/realtime';
import { seedProject } from '../helpers/seed';
import { authHeaders, registerTestUser, type TestUser } from '../helpers/users';

// Contrato de socket-events.md y research R2 de la 005: JWT en el handshake, membresía al unirse
// a cada sala, payloads validados y desconexión si el token caduca sin renovarse.

let app: FastifyInstance;
let url: string;
let ana: TestUser;
let luis: TestUser;
let outsider: TestUser;
let projectId: string;
let published: string;
let draft: string;
const logs: string[] = [];

beforeAll(async () => {
  const { Writable } = await import('node:stream');
  ({ app } = await buildTestApp('realtimeauth', {
    withAuth: true,
    featureFlags: 'realtime=true',
    realtime: { tokenGraceMs: 300 },
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    }),
  }));
  url = await app.listen({ port: 0, host: '127.0.0.1' });
  ana = await registerTestUser(app, 'Ana');
  luis = await registerTestUser(app, 'Luis');
  outsider = await registerTestUser(app, 'Marta');
  projectId = await seedProject(app, {
    status: 'open',
    members: [
      [ana, 'admin'],
      [luis, 'participant'],
    ],
  });
  published = (await publishedDiagram(app, authHeaders(ana), projectId)).versionId;
  draft = (await uploadDiagram(app, authHeaders(ana), projectId)).json().id;
});
afterEach(() => closeSockets());
afterAll(() => closeTestApp(app));

const join = (socket: ClientSocket, payload: unknown) =>
  socket.timeout(2000).emitWithAck('room:join', payload as { versionId: string });

describe('handshake', () => {
  it('sin token, con un token inválido o caducado → unauthorized', async () => {
    expect(await tryHandshake(url)).toBe('unauthorized');
    expect(await tryHandshake(url, { token: 'no-es-un-jwt' })).toBe('unauthorized');
    const expired = app.jwt.sign(
      { sub: ana.id, sid: 's1' },
      { clockTimestamp: Date.now() - 60_000, expiresIn: '10s' },
    );
    expect(await tryHandshake(url, { token: expired })).toBe('unauthorized');
  });

  it('con un access token válido conecta', async () => {
    expect(await tryHandshake(url, { token: ana.accessToken })).toBe('connected');
  });

  it('solo WebSocket: el long-polling se rechaza', async () => {
    const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`);
    expect(response.status).toBe(400);
  });
});

describe('room:join', () => {
  it('un miembro se une a la versión publicada', async () => {
    const socket = await connect(url, luis.accessToken);
    expect(await join(socket, { versionId: published })).toEqual({
      ok: true,
      presence: [expect.objectContaining({ userId: luis.id, name: luis.name })],
    });
  });

  it('el borrador solo para el Administrador (canSeeVersion de la 003)', async () => {
    const participant = await connect(url, luis.accessToken);
    expect(await join(participant, { versionId: draft })).toEqual({
      ok: false,
      code: 'not_found',
    });
    const admin = await connect(url, ana.accessToken);
    expect((await join(admin, { versionId: draft })).ok).toBe(true);
  });

  it('quien no es miembro, o una versión que no existe → not_found', async () => {
    const socket = await connect(url, outsider.accessToken);
    expect(await join(socket, { versionId: published })).toEqual({
      ok: false,
      code: 'not_found',
    });
    const member = await connect(url, luis.accessToken);
    expect(await join(member, { versionId: new Types.ObjectId().toHexString() })).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(await join(member, { versionId: 'no-es-un-id' })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('un payload inválido responde invalid y queda en el log', async () => {
    const socket = await connect(url, luis.accessToken);
    expect(await join(socket, { version: published })).toEqual({ ok: false, code: 'invalid' });
    expect(logs.some((line) => line.includes('room:join') && line.includes('inválido'))).toBe(true);
  });

  it('en un proyecto que se está borrando → not_found', async () => {
    const deleting = await seedProject(app, { status: 'open', members: [[ana, 'admin']] });
    const { versionId } = await publishedDiagram(app, authHeaders(ana), deleting);
    await app.mongo
      .collection('projects')
      .updateOne({ _id: new Types.ObjectId(deleting) }, { $set: { status: 'deleting' } });
    const socket = await connect(url, ana.accessToken);
    expect(await join(socket, { versionId })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('caducidad del token', () => {
  const shortToken = (user: TestUser, seconds: number) =>
    app.jwt.sign({ sub: user.id, sid: 's1' }, { expiresIn: `${seconds}s` });

  it('sin renovar, el socket se desconecta pasado el margen tras la caducidad', async () => {
    const socket = await connect(url, shortToken(luis, 1));
    expect(await disconnected(socket, 3000)).toBe('io server disconnect');
  });

  it('auth:refresh con un token válido renueva la identidad y evita la desconexión', async () => {
    const socket = await connect(url, shortToken(luis, 1));
    expect(
      await socket.timeout(2000).emitWithAck('auth:refresh', { token: luis.accessToken }),
    ).toEqual({ ok: true });
    await pause(1800);
    expect(socket.connected).toBe(true);
  });

  it('auth:refresh con el token de otra persona o inválido se rechaza', async () => {
    const socket = await connect(url, luis.accessToken);
    expect(
      await socket.timeout(2000).emitWithAck('auth:refresh', { token: ana.accessToken }),
    ).toEqual({ ok: false });
    expect(await socket.timeout(2000).emitWithAck('auth:refresh', { token: 'x' })).toEqual({
      ok: false,
    });
  });
});
