import { imageReady, login } from './diagrams';
import { createDetail, projectWithPublishedDiagram, registerTeam, selectActivity } from './details';
import { expect, test } from './fixtures';

// US3: indicadores de cobertura en el diagrama (quickstart §3). Solo contra el stack local.

test('contadores, marcas «Sin detalles», mapa de calor con leyenda y notas', async ({
  page,
  request,
}) => {
  const { admin, luis, marta } = await registerTeam(request);
  await login(page, admin);
  const diagram = await projectWithPublishedDiagram(page, admin, [luis, marta]);
  const key = (label: string) => diagram.activities.get(label)!.key;
  // Detalles en 3 de las 6 actividades: 2 en "Validar pago" y 1 en otras dos.
  await createDetail(request, luis, diagram.diagramId, key('Validar pago'), {
    then: 'el sistema confirma el pago',
  });
  await createDetail(request, marta, diagram.diagramId, key('Validar pago'), {
    then: 'avisa si la tarjeta es rechazada',
  });
  await createDetail(request, luis, diagram.diagramId, key('Emitir factura'));
  await createDetail(request, luis, diagram.diagramId, key('Enviar pedido'));

  await page.goto(`/proyectos/${diagram.projectId}/diagramas/${diagram.diagramId}`);
  await imageReady(page);
  const canvas = page.getByRole('main');
  await expect(canvas.getByRole('button', { name: /requisito\(s\): mostrar notas/ })).toHaveCount(
    3,
  );
  await expect(canvas.getByText('Sin detalles')).toHaveCount(3);
  await expect(canvas.getByRole('button', { name: '2 requisito(s): mostrar notas' })).toBeVisible();

  // Notas de "Validar pago": sus dos resúmenes; se pueden contraer.
  await canvas.getByRole('button', { name: '2 requisito(s): mostrar notas' }).click();
  const notes = canvas.getByRole('list', { name: 'Notas de los requisitos' });
  await expect(notes.getByRole('listitem')).toHaveCount(2);
  await expect(notes).toContainText('Entonces avisa si la tarjeta es rechazada');
  await canvas.getByRole('button', { name: '2 requisito(s): ocultar notas' }).click();
  await expect(notes).toHaveCount(0);

  // Mapa de calor con leyenda.
  const panel = page.getByRole('complementary', { name: 'Requisitos' });
  await panel.getByRole('button', { name: 'Mapa de calor' }).click();
  await expect(panel.getByRole('button', { name: 'Mapa de calor' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('list', { name: 'Leyenda del mapa de calor' })).toBeVisible();

  // Registrar un detalle en una actividad sin detalles actualiza su indicador.
  const inicio = await selectActivity(page, diagram, 'Inicio');
  await inicio.getByLabel('Dado (contexto)').fill('el cliente abre la tienda');
  await inicio.getByLabel('Cuando (acción)').fill('entra en el catálogo');
  await inicio.getByLabel('Entonces (resultado)').fill('ve los productos destacados');
  await inicio.getByRole('button', { name: 'Guardar requisito' }).click();
  await expect(canvas.getByText('Sin detalles')).toHaveCount(2);
});
