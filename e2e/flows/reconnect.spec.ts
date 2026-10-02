import type { APIRequestContext } from '@playwright/test';
import { login } from './diagrams';
import { expect, test } from './fixtures';
import {
  createDetail,
  openWorkspace,
  projectWithPublishedDiagram,
  registerTeam,
  selectActivity,
  waitConnected,
} from './realtime';
import type { Member } from './details';

// US4 de la 005 (quickstart §4): desconexión sin perder el borrador, resincronización al volver
// y revocación inmediata.

const auth = (member: Member) => ({ authorization: `Bearer ${member.accessToken}` });

test('sin red se conserva el borrador y al volver llegan los cambios; retirar y cerrar al instante', async ({
  page,
  browser,
  request,
}) => {
  const { admin: ana, luis, marta } = await registerTeam(request);
  await login(page, ana);
  const diagram = await projectWithPublishedDiagram(page, ana, [luis, marta]);
  const key = diagram.activities.get('Validar pago')!.key;

  const luisPage = await openWorkspace(browser, luis, diagram);
  const luisPanel = await selectActivity(luisPage, diagram, 'Validar pago');
  await waitConnected(luisPage);
  const martaPage = await openWorkspace(browser, marta, diagram);
  const martaPanel = await selectActivity(martaPage, diagram, 'Validar pago');
  await waitConnected(martaPage);

  // Luis se queda sin red: aviso, guardar deshabilitado y un borrador a medias.
  await luisPage.context().setOffline(true);
  await expect(luisPage.getByRole('alert')).toContainText('Sin conexión: reintentando', {
    timeout: 15_000,
  });
  await luisPanel.getByLabel('Cuando (acción)').fill('paga con transferencia');
  await expect(luisPanel.getByRole('button', { name: 'Guardar requisito' })).toBeDisabled();

  // Mientras tanto, Ana registra dos requisitos.
  await createDetail(request, ana, diagram.diagramId, key, { then: 'el banco confirma el pago' });
  await createDetail(request, ana, diagram.diagramId, key, { then: 'se envía el recibo' });

  // Luis vuelve: ve los dos y conserva su borrador (SC-003, FR-007).
  await luisPage.context().setOffline(false);
  await expect(luisPage.getByRole('alert')).toHaveCount(0, { timeout: 15_000 });
  await expect(luisPanel.getByRole('article')).toHaveCount(2);
  await expect(luisPanel.getByLabel('Cuando (acción)')).toHaveValue('paga con transferencia');
  await expect(luisPanel.getByRole('button', { name: 'Guardar requisito' })).toBeEnabled();

  // Ana retira a Luis: Luis lo ve al instante (FR-008).
  await removeMember(request, ana, diagram.projectId, luis);
  await expect(luisPage.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();
  await expect(luisPage.getByRole('status')).toHaveText('Ya no tienes acceso a este proyecto.');

  // Ana cierra el proyecto: Marta pasa a solo lectura sin recargar.
  const closed = await request.post(`/api/projects/${diagram.projectId}/status`, {
    headers: auth(ana),
    data: { action: 'close' },
  });
  expect(closed.status()).toBe(200);
  await expect(martaPanel.getByRole('button', { name: 'Guardar requisito' })).toHaveCount(0);
  await expect(martaPanel).toContainText('El proyecto está cerrado');
  await expect(martaPanel.getByRole('article')).toHaveCount(2);
});

async function removeMember(
  request: APIRequestContext,
  admin: Member,
  projectId: string,
  member: Member,
) {
  const me = (await (await request.get('/api/me', { headers: auth(member) })).json()) as {
    id: string;
  };
  const response = await request.delete(`/api/projects/${projectId}/members/${me.id}`, {
    headers: auth(admin),
  });
  expect(response.status()).toBe(204);
}
