import type { Browser, Page } from '@playwright/test';
import { imageReady, login } from './diagrams';
import type { Member, PublishedDiagram } from './details';
import { expect } from './fixtures';

export { createDetail, projectWithPublishedDiagram, registerTeam, selectActivity } from './details';

/**
 * Espera a que el espacio de trabajo tenga el socket conectado y unido a la sala del diagrama
 * (`data-realtime-status` de `RealtimeWorkspace`, feature 005).
 */
export async function waitConnected(page: Page) {
  await expect(page.locator('[data-realtime-status="joined"]')).toBeAttached({ timeout: 10_000 });
}

/**
 * Abre el diagrama en un contexto de navegador propio con la sesión de `member`: cada persona
 * del recorrido es un navegador distinto, como en la sesión real.
 */
export async function openWorkspace(browser: Browser, member: Member, diagram: PublishedDiagram) {
  const page = await (await browser.newContext()).newPage();
  await login(page, member);
  await page.goto(`/proyectos/${diagram.projectId}/diagramas/${diagram.diagramId}`);
  await imageReady(page);
  await waitConnected(page);
  return page;
}
