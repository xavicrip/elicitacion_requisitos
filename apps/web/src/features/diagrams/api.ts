import type { DiagramSummary, DiagramVersion, VersionWithActivities } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiBlob, apiFetch, apiUpload } from '../../lib/api-client';

/** Llamadas a la API de diagramas (contracts/diagrams.openapi.yaml). */
export const diagramsApi = {
  list: (projectId: string) => apiFetch<DiagramSummary[]>(`/projects/${projectId}/diagrams`),
  version: (versionId: string) => apiFetch<VersionWithActivities>(`/diagram-versions/${versionId}`),
  create: (projectId: string, name: string, file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('name', name);
    form.append('file', file);
    return apiUpload<DiagramVersion>(`/projects/${projectId}/diagrams`, form, onProgress);
  },
  addVersion: (diagramId: string, file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return apiUpload<DiagramVersion>(`/diagrams/${diagramId}/versions`, form, onProgress);
  },
  publish: (versionId: string) =>
    apiFetch<DiagramVersion>(`/diagram-versions/${versionId}/publish`, { method: 'POST' }),
};

export const diagramKeys = {
  list: (projectId: string) => ['projects', projectId, 'diagrams'] as const,
  version: (versionId: string) => ['diagram-versions', versionId] as const,
  image: (url: string) => ['diagram-images', url] as const,
};

/**
 * URL local (`blob:`) de una imagen servida por la API. Las imágenes de una versión no cambian
 * (la API las sirve como inmutables), así que no se vuelven a pedir.
 */
export function useImageUrl(url: string | undefined): string | undefined {
  const { data } = useQuery({
    queryKey: diagramKeys.image(url ?? ''),
    queryFn: () => apiBlob(url!),
    enabled: Boolean(url),
    staleTime: Infinity,
  });
  const [objectUrl, setObjectUrl] = useState<string>();
  useEffect(() => {
    if (!data) return;
    const created = URL.createObjectURL(data);
    setObjectUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [data]);
  return objectUrl;
}
