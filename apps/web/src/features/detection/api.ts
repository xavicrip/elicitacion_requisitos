import type { DetectionJob, DetectionStartInput, Proposals } from '@reqcanvas/shared';
import { ApiError, apiFetch } from '../../lib/api-client';

/** Llamadas a la detección asistida (feature 006, contracts/detection.openapi.yaml). */
export const detectionApi = {
  start: (versionId: string, input: DetectionStartInput = {}) =>
    apiFetch<DetectionJob>(`/diagram-versions/${versionId}/detections`, {
      method: 'POST',
      body: input,
    }),
  /** Última detección de la versión; `null` si nunca se lanzó. */
  latest: async (versionId: string): Promise<DetectionJob | null> => {
    try {
      return await apiFetch<DetectionJob>(`/diagram-versions/${versionId}/detections`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  proposals: (versionId: string) => apiFetch<Proposals>(`/diagram-versions/${versionId}/proposals`),
};

export const detectionKeys = {
  job: (versionId: string) => ['detection', versionId, 'job'] as const,
  proposals: (versionId: string) => ['detection', versionId, 'proposals'] as const,
};

export const isRunning = (job: DetectionJob | null | undefined) =>
  job?.status === 'pending' || job?.status === 'running';
