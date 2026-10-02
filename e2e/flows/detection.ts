import type { Page } from '@playwright/test';
import { openProject, uploadDiagram } from './diagrams';
import { expect } from './fixtures';

// Helpers de la detección asistida (feature 006): un borrador sin actividades sobre el que
// lanzar la detección y esperar a que el worker termine.

export type DetectionJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress?: { stage: string; pct: number };
  error?: { code: string; message: string };
};

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Proyecto abierto con `compra-simple.png` subido como borrador, aún sin actividades. */
export async function draftWithoutActivities(page: Page, accessToken: string) {
  const projectId = await openProject(page, accessToken);
  const version = await uploadDiagram(page, accessToken, projectId);
  return { projectId, diagramId: version.diagramId, versionId: version.id };
}

/** Lanza la detección por la API (`202`) y devuelve el job. */
export async function startDetection(
  page: Pick<Page, 'request'>,
  accessToken: string,
  versionId: string,
) {
  const response = await page.request.post(`/api/diagram-versions/${versionId}/detections`, {
    headers: auth(accessToken),
    data: {},
  });
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()) as DetectionJob;
}

/** Última detección de la versión. */
export async function latestDetection(
  page: Pick<Page, 'request'>,
  accessToken: string,
  versionId: string,
) {
  const response = await page.request.get(`/api/diagram-versions/${versionId}/detections`, {
    headers: auth(accessToken),
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as DetectionJob;
}

/** Espera a que la última detección termine (`done` o `failed`) y la devuelve. */
export async function waitForDetection(
  page: Pick<Page, 'request'>,
  accessToken: string,
  versionId: string,
  timeoutMs = 90_000,
) {
  let job: DetectionJob | undefined;
  await expect
    .poll(
      async () => {
        job = await latestDetection(page, accessToken, versionId);
        return job.status;
      },
      { timeout: timeoutMs, intervals: [500, 1000, 2000] },
    )
    .toMatch(/^(done|failed)$/);
  return job!;
}
