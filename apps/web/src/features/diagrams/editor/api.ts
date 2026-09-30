import type { Activity, ActivityInput, ActivityPatch } from '@reqcanvas/shared';
import type { QueryClient } from '@tanstack/react-query';
import type { VersionWithActivities } from '@reqcanvas/shared';
import { apiFetch } from '../../../lib/api-client';
import { diagramKeys } from '../api';

/** Actividades de una versión en borrador (contracts/diagrams.openapi.yaml). */
export const activitiesApi = {
  create: (versionId: string, input: ActivityInput) =>
    apiFetch<Activity>(`/diagram-versions/${versionId}/activities`, {
      method: 'POST',
      body: input,
    }),
  /** `rev` es el último guardado: la API responde 409 con la actividad actual si cambió. */
  update: (id: string, rev: number, patch: ActivityPatch) =>
    apiFetch<Activity>(`/activities/${id}`, {
      method: 'PATCH',
      body: patch,
      headers: { 'if-match': `"${rev}"` },
    }),
  remove: (id: string, confirm = false) =>
    apiFetch<void>(`/activities/${id}${confirm ? '?confirm=true' : ''}`, { method: 'DELETE' }),
};

/** Cambios locales en la caché de la versión (la fuente de verdad del editor). */
export const activityCache = {
  get(queryClient: QueryClient, versionId: string, id: string): Activity | undefined {
    return queryClient
      .getQueryData<VersionWithActivities>(diagramKeys.version(versionId))
      ?.activities.find((activity) => activity.id === id);
  },
  update(
    queryClient: QueryClient,
    versionId: string,
    id: string,
    change: (activity: Activity) => Activity,
  ) {
    queryClient.setQueryData<VersionWithActivities>(
      diagramKeys.version(versionId),
      (version) =>
        version && {
          ...version,
          activities: version.activities.map((activity) =>
            activity.id === id ? change(activity) : activity,
          ),
        },
    );
  },
  add(queryClient: QueryClient, versionId: string, activity: Activity) {
    queryClient.setQueryData<VersionWithActivities>(
      diagramKeys.version(versionId),
      (version) => version && { ...version, activities: [...version.activities, activity] },
    );
  },
  /** Como la API: retira también su `key` de las transiciones de las demás. */
  remove(queryClient: QueryClient, versionId: string, removed: Activity) {
    queryClient.setQueryData<VersionWithActivities>(
      diagramKeys.version(versionId),
      (version) =>
        version && {
          ...version,
          activities: version.activities
            .filter((activity) => activity.id !== removed.id)
            .map((activity) =>
              activity.next.includes(removed.key)
                ? { ...activity, next: activity.next.filter((key) => key !== removed.key) }
                : activity,
            ),
        },
    );
  },
};
