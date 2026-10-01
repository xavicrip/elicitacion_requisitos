import type { APIRequestContext, Page } from '@playwright/test';
import { fixtureActivities, openProject, publishFixture } from './diagrams';
import { expect } from './fixtures';
import { newUser, registerUser, type TestUser } from './helpers';

/** Usuario registrado con su access token. */
export type Member = TestUser & { accessToken: string };

const auth = (member: Member) => ({ authorization: `Bearer ${member.accessToken}` });

/** Invita a `participant` al proyecto (enlace del Administrador) y acepta la invitación. */
export async function inviteParticipant(
  request: APIRequestContext,
  admin: Member,
  projectId: string,
  participant: Member,
) {
  const created = await request.post(`/api/projects/${projectId}/invitations`, {
    headers: auth(admin),
  });
  expect(created.status()).toBe(201);
  const token = ((await created.json()) as { url: string }).url.split('/').pop()!;
  const accepted = await request.post(`/api/invitations/${token}/accept`, {
    headers: auth(participant),
  });
  expect(accepted.status()).toBe(200);
}

type BBox = { x: number; y: number; w: number; h: number };

export type PublishedDiagram = {
  projectId: string;
  diagramId: string;
  versionId: string;
  /** Actividades publicadas, por nombre. */
  activities: Map<string, { key: string; bbox: BBox }>;
};

/**
 * Proyecto abierto con `compra-simple.png` publicado (6 actividades) y, si se indican,
 * Participantes invitados. Lo crea todo por la API a través del proxy de web.
 */
export async function projectWithPublishedDiagram(
  page: Page,
  admin: Member,
  participants: Member[] = [],
): Promise<PublishedDiagram> {
  const projectId = await openProject(page, admin.accessToken);
  for (const participant of participants) {
    await inviteParticipant(page.request, admin, projectId, participant);
  }
  const version = await publishFixture(
    page,
    admin.accessToken,
    projectId,
    'compra-simple.png',
    'Proceso de compra',
  );
  const response = await page.request.get(`/api/diagram-versions/${version.id}`, {
    headers: auth(admin),
  });
  const { activities } = (await response.json()) as {
    activities: Array<{ key: string; label: string; bbox: BBox }>;
  };
  expect(activities).toHaveLength(fixtureActivities('compra-simple.json').length);
  return {
    projectId,
    diagramId: version.diagramId,
    versionId: version.id,
    activities: new Map(activities.map(({ key, label, bbox }) => [label, { key, bbox }])),
  };
}

/** Un Administrador y dos Participantes registrados por la API. */
export async function registerTeam(request: APIRequestContext) {
  return {
    admin: await registerUser(request, newUser('Ana')),
    luis: await registerUser(request, newUser('Luis')),
    marta: await registerUser(request, newUser('Marta')),
  };
}

export type DetailInput = {
  given: string;
  when: string;
  then: string;
  type: 'functional' | 'non_functional' | 'business_rule' | 'constraint';
  priority?: 'must' | 'should' | 'could' | 'wont' | null;
  authorRole?: string | null;
  tags?: string[];
};

/** Registra un detalle de requisito en una actividad por la API. */
export async function createDetail(
  request: APIRequestContext,
  author: Member,
  diagramId: string,
  activityKey: string,
  input: Partial<DetailInput> = {},
) {
  const response = await request.post(
    `/api/diagrams/${diagramId}/activities/${activityKey}/details`,
    {
      headers: auth(author),
      data: {
        given: 'el cliente tiene productos en el carrito',
        when: 'paga con tarjeta',
        then: 'el sistema confirma el pago en menos de 5 segundos',
        type: 'non_functional',
        ...input,
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; rev: number };
}
