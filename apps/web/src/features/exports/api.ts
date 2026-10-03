import type { DashboardFilters, Export, ExportFormat, ExportOptions } from '@reqcanvas/shared';
import { apiFetch, apiRaw } from '../../lib/api-client';

export type ExportFile = { blob: Blob; fileName: string };
/** Resultado de solicitar una exportación: el archivo al momento o una en segundo plano. */
export type ExportOutcome =
  ({ kind: 'file'; empty: boolean } & ExportFile) | { kind: 'queued'; exported: Export };

export type ExportInput = {
  format: ExportFormat;
  filters: DashboardFilters;
  options?: Partial<ExportOptions>;
};

function fileNameOf(response: Response, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
  return match?.[1] ?? fallback;
}

async function fileOf(response: Response, fallback: string): Promise<ExportFile> {
  return { blob: await response.blob(), fileName: fileNameOf(response, fallback) };
}

export const exportsApi = {
  async request(projectId: string, input: ExportInput): Promise<ExportOutcome> {
    const response = await apiRaw(`/projects/${projectId}/exports`, {
      method: 'POST',
      body: input,
    });
    if (response.status === 202) {
      return { kind: 'queued', exported: (await response.json()) as Export };
    }
    return {
      kind: 'file',
      empty: response.headers.get('x-export-empty') === 'true',
      ...(await fileOf(response, `reqcanvas.${input.format}`)),
    };
  },
  get: (exportId: string) => apiFetch<Export>(`/exports/${exportId}`),
  list: (projectId: string) => apiFetch<Export[]>(`/projects/${projectId}/exports`),
  async download(exported: Pick<Export, 'id' | 'fileName'>): Promise<ExportFile> {
    return fileOf(await apiRaw(`/exports/${exported.id}/download`), exported.fileName ?? 'export');
  },
};

export const exportKeys = {
  list: (projectId: string) => ['projects', projectId, 'exports'] as const,
  one: (exportId: string) => ['exports', exportId] as const,
};

/** Entrega un archivo al navegador como descarga. */
export function saveFile({ blob, fileName }: ExportFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
