import type { FastifyInstance } from 'fastify';
import { uploadDiagram } from './diagrams';

/** Flags de las pruebas de la 004. */
export const scenario = {
  given: 'el cliente tiene productos en el carrito',
  when: 'paga con tarjeta',
  then: 'el sistema confirma el pago en menos de 5 segundos',
  type: 'non_functional',
};

/**
 * Diagrama publicado con una actividad por nombre (subida, actividades y publicación por la
 * API). Devuelve las `key` por nombre.
 */
export async function publishedDiagram(
  app: FastifyInstance,
  headers: Record<string, string>,
  projectId: string,
  labels = ['Validar pago', 'Emitir factura', 'Enviar pedido'],
) {
  const version = (await uploadDiagram(app, headers, projectId)).json();
  const keys: Record<string, string> = {};
  for (const [index, label] of labels.entries()) {
    const response = await app.inject({
      method: 'POST',
      url: `/diagram-versions/${version.id}/activities`,
      headers,
      payload: { label, type: 'action', bbox: { x: 0.1, y: 0.1 * (index + 1), w: 0.2, h: 0.05 } },
    });
    keys[label] = response.json().key;
  }
  const published = await app.inject({
    method: 'POST',
    url: `/diagram-versions/${version.id}/publish`,
    headers,
  });
  if (published.statusCode !== 200) throw new Error(`Publicación fallida: ${published.body}`);
  return { diagramId: version.diagramId as string, versionId: version.id as string, keys };
}

/** Ruta de los detalles de una actividad. */
export const detailsUrl = (diagramId: string, key: string, query = '') =>
  `/diagrams/${diagramId}/activities/${key}/details${query}`;

/** Registra un detalle por la API. */
export function createDetail(
  app: FastifyInstance,
  headers: Record<string, string>,
  diagramId: string,
  key: string,
  payload: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: detailsUrl(diagramId, key),
    headers,
    payload: { ...scenario, ...payload },
  });
}
