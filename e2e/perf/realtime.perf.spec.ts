import { randomInt } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { imageReady, login, openProject, publishFixture } from '../flows/diagrams';
import { inviteParticipant, type Member } from '../flows/details';
import { expect, test } from '../flows/fixtures';
import { newUser } from '../flows/helpers';
import { waitConnected } from '../flows/realtime';
import { measureNavigation } from './frames';

// T042 (005, plan ajuste 12; research R8): 50 clientes de socket.io-client en el mismo diagrama,
// con cursores a 20 Hz. Solo contra el stack local: `pnpm e2e --project perf -g realtime`.
// Los resultados se anotan en plan.md.

const CLIENTS = 50;
const baseURL = process.env.BASE_URL || 'http://localhost:5173';
/** Tamaño de `cien-actividades.png`. */
const IMAGE = { width: 3000, height: 2000 };

/**
 * Registra `count` cuentas, cada una desde su propia IP (el rate limit de /auth es por IP), y
 * crea un proyecto del primero con los demás como Participantes y `cien-actividades.png`
 * publicado.
 */
async function crowd(request: APIRequestContext, count: number) {
  const members: Member[] = [];
  for (let i = 0; i < count; i++) {
    const user = newUser(i === 0 ? 'Ana' : `P${i}`);
    const response = await request.post('/api/auth/register', {
      data: user,
      headers: { 'x-real-ip': `198.51.${randomInt(256)}.${randomInt(1, 255)}` },
    });
    expect(response.status(), await response.text()).toBe(201);
    members.push({
      ...user,
      accessToken: ((await response.json()) as { accessToken: string }).accessToken,
    });
  }
  return members;
}

async function setup(page: Page, request: APIRequestContext, count: number) {
  const [admin, ...participants] = await crowd(request, count);
  const projectId = await openProject(page, admin!.accessToken);
  for (const participant of participants) {
    await inviteParticipant(page.request, admin!, projectId, participant);
  }
  const version = await publishFixture(
    page,
    admin!.accessToken,
    projectId,
    'cien-actividades.png',
    'Cien actividades',
  );
  const headers = { authorization: `Bearer ${admin!.accessToken}` };
  const { activities } = (await (
    await page.request.get(`/api/diagram-versions/${version.id}`, { headers })
  ).json()) as { activities: Array<{ key: string }> };
  return { admin: admin!, participants, projectId, version, activities };
}

type Client = { socket: Socket; disconnects: number };

/** Socket conectado y unido a la sala de la versión, como el cliente web (solo WebSocket). */
async function join(member: Member, versionId: string): Promise<Client> {
  const socket = io(baseURL, {
    transports: ['websocket'],
    reconnection: false,
    auth: { token: member.accessToken },
  });
  const client = { socket, disconnects: 0 };
  socket.on('disconnect', () => client.disconnects++);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const ack = (await socket.timeout(5000).emitWithAck('room:join', { versionId })) as {
    ok: boolean;
  };
  expect(ack.ok).toBe(true);
  return client;
}

/** Cada cliente mueve su cursor en círculo sobre la imagen a 20 Hz. */
function moveCursors(clients: Client[], versionId: string) {
  let step = 0;
  const timer = setInterval(() => {
    step++;
    clients.forEach(({ socket }, i) => {
      const angle = step / 10 + (i * 2 * Math.PI) / clients.length;
      socket.volatile.emit('cursor:move', {
        versionId,
        x: Math.round(IMAGE.width / 2 + 600 * Math.cos(angle)),
        y: Math.round(IMAGE.height / 2 + 400 * Math.sin(angle)),
      });
    });
  }, 50);
  return () => clearInterval(timer);
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};

test('50 clientes: p95 < 500 ms, sin desconexiones y cada evento una vez (SC-001, SC-002, SC-004)', async ({
  page,
  request,
}) => {
  test.setTimeout(6 * 60_000);
  const { admin, participants, version, activities } = await setup(page, request, CLIENTS);
  const clients = await Promise.all(
    [admin, ...participants].map((member) => join(member, version.id)),
  );

  // Recepción de cada `detail.created`: latencia `recepción − at` y conteo por `eventId`.
  const latencies: number[] = [];
  const received = clients.map(() => new Map<string, number>());
  clients.forEach(({ socket }, i) =>
    socket.on('detail.created', (payload: { eventId: string; at: string }) => {
      latencies.push(Date.now() - Date.parse(payload.at));
      received[i]!.set(payload.eventId, (received[i]!.get(payload.eventId) ?? 0) + 1);
    }),
  );

  const stop = moveCursors(clients, version.id);
  // Un detalle cada 30 s durante 2 min, cada uno de una persona distinta.
  const DETAILS = 4;
  const authors = [admin, ...participants];
  for (let n = 0; n < DETAILS; n++) {
    const created = await page.request.post(
      `/api/diagrams/${version.diagramId}/activities/${activities[n]!.key}/details`,
      {
        headers: { authorization: `Bearer ${authors[n]!.accessToken}` },
        data: {
          given: 'el cliente tiene productos',
          when: `paga (${n})`,
          then: 'el sistema confirma el pago',
          type: 'functional',
        },
      },
    );
    expect(created.status()).toBe(201);
    await page.waitForTimeout(30_000);
  }
  stop();
  await page.waitForTimeout(1000);

  const p95 = percentile(latencies, 0.95);
  const disconnects = clients.reduce((sum, client) => sum + client.disconnects, 0);
  console.log(
    `[perf] realtime · ${CLIENTS} clientes · ${latencies.length} recepciones · p50 ${percentile(latencies, 0.5)} ms · p95 ${p95} ms · máx ${Math.max(...latencies)} ms · desconexiones ${disconnects}`,
  );
  for (const socket of clients.map((client) => client.socket)) socket.close();

  expect(p95).toBeLessThan(500);
  expect(disconnects).toBe(0);
  for (const counts of received) {
    expect(counts.size).toBe(DETAILS);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  }
});

test('≥ 50 FPS con 50 cursores sobre cien-actividades.png (plan, ajuste 9)', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(4 * 60_000);
  // Ana en el navegador y 50 Participantes moviendo el cursor.
  const { admin, participants, projectId, version } = await setup(page, request, CLIENTS + 1);
  const clients = await Promise.all(participants.map((member) => join(member, version.id)));
  const anaPage = await (await browser.newContext()).newPage();
  await login(anaPage, admin);
  await anaPage.goto(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
  await imageReady(anaPage);
  await waitConnected(anaPage);

  const stop = moveCursors(clients, version.id);
  await expect(anaPage.getByTestId('remote-cursor')).toHaveCount(CLIENTS, {
    timeout: 10_000,
  });
  const { zoom, pan } = await measureNavigation(anaPage);
  stop();
  for (const { socket } of clients) socket.close();
  console.log(
    `[perf] 50 cursores · zoom: ${JSON.stringify(zoom)} · desplazamiento: ${JSON.stringify(pan)}`,
  );
  expect(zoom.fps).toBeGreaterThanOrEqual(50);
  expect(pan.fps).toBeGreaterThanOrEqual(50);
});
