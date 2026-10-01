import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import type { TestUser } from './helpers';

/** Estado del espacio de trabajo expuesto con `E2E_HOOKS=true` (plan de la 003, ajuste 8). */
export type CanvasState = {
  versionId: string;
  mode: 'view' | 'edit';
  selectedActivityKey: string | null;
  hoveredActivityKey: string | null;
  imageStatus: 'loading' | 'ready' | 'error';
  camera: { zoom: number; center: { x: number; y: number } };
};

declare global {
  interface Window {
    __canvasState?: CanvasState;
  }
}

export const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../fixtures/diagrams/${name}`, import.meta.url));

type FixtureActivity = {
  label: string;
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
};

/** Actividades esperadas de una fixture (`scripts/fixtures/diagrams.mjs`). */
export const fixtureActivities = (name: string): FixtureActivity[] =>
  (JSON.parse(readFileSync(fixturePath(name), 'utf8')) as { activities: FixtureActivity[] })
    .activities;

export async function login(page: Page, user: TestUser) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();
}

/** Proyecto abierto del usuario, creado por la API a través del proxy de web. */
export async function openProject(page: Page, accessToken: string): Promise<string> {
  const headers = { authorization: `Bearer ${accessToken}` };
  const created = await page.request.post('/api/projects', {
    headers,
    data: { name: `Diagramas ${Date.now()}` },
  });
  const { id } = (await created.json()) as { id: string };
  await page.request.post(`/api/projects/${id}/status`, { headers, data: { action: 'open' } });
  return id;
}

/** Sube un diagrama por la API; devuelve la versión 1 (borrador). */
export async function uploadDiagram(
  page: Page,
  accessToken: string,
  projectId: string,
  file = 'compra-simple.png',
  name = 'Proceso de compra',
) {
  const response = await page.request.post(`/api/projects/${projectId}/diagrams`, {
    headers: { authorization: `Bearer ${accessToken}` },
    multipart: {
      name,
      file: { name: file, mimeType: 'image/png', buffer: readFileSync(fixturePath(file)) },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; diagramId: string };
}

export const canvasState = (page: Page) => page.evaluate(() => window.__canvasState);

export const imageReady = (page: Page) =>
  expect.poll(async () => (await canvasState(page))?.imageStatus).toBe('ready');

/** Punto de pantalla de un punto de la imagen (px), con la cámara actual. */
export async function toScreen(page: Page, point: { x: number; y: number }) {
  const state = await canvasState(page);
  const box = await page.getByRole('main').locator('canvas').boundingBox();
  if (!state || !box) throw new Error('Canvas no disponible');
  const { zoom, center } = state.camera;
  return {
    x: box.x + box.width / 2 + (point.x - center.x) * zoom,
    y: box.y + box.height / 2 + (point.y - center.y) * zoom,
  };
}

/** Arrastra en el canvas entre dos puntos de la imagen (px). */
export async function dragOnImage(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await toScreen(page, from);
  const end = await toScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

/** Sube una fixture, marca sus actividades por la API y publica la versión. */
export async function publishFixture(
  page: Page,
  accessToken: string,
  projectId: string,
  file: string,
  name = 'Diagrama grande',
) {
  const headers = { authorization: `Bearer ${accessToken}` };
  const version = await uploadDiagram(page, accessToken, projectId, file, name);
  for (const activity of fixtureActivities(file.replace(/\.png$/, '.json'))) {
    const created = await page.request.post(`/api/diagram-versions/${version.id}/activities`, {
      headers,
      data: activity,
    });
    expect(created.status()).toBe(201);
  }
  const published = await page.request.post(`/api/diagram-versions/${version.id}/publish`, {
    headers,
  });
  expect(published.status()).toBe(200);
  return version;
}

/** Sube una versión nueva (borrador) de un diagrama por la API. */
export async function uploadVersion(
  page: Page,
  accessToken: string,
  diagramId: string,
  file = 'compra-simple.png',
) {
  const response = await page.request.post(`/api/diagrams/${diagramId}/versions`, {
    headers: { authorization: `Bearer ${accessToken}` },
    multipart: {
      file: { name: file, mimeType: 'image/png', buffer: readFileSync(fixturePath(file)) },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
