import type { Export } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { exportKeys, exportsApi, saveFile, type ExportInput } from './api';

/** Cada cuánto se consulta una exportación en curso (plan de la 008, ajuste 7). */
export const polling = { intervalMs: 3000 };

const active = (exported: Export | undefined) =>
  exported?.status === 'pending' || exported?.status === 'running';

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/**
 * Exportación de un proyecto: las pequeñas se descargan al momento; las grandes quedan en
 * segundo plano y se consultan cada 3 s hasta que están listas para descargar.
 */
export function useExport(projectId: string) {
  const client = useQueryClient();
  const [exportId, setExportId] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState('');

  const current = useQuery({
    queryKey: exportKeys.one(exportId ?? ''),
    queryFn: () => exportsApi.get(exportId!),
    enabled: Boolean(exportId),
    refetchInterval: (query) => (active(query.state.data) ? polling.intervalMs : false),
  });

  const request = useMutation({
    mutationFn: (input: ExportInput) => exportsApi.request(projectId, input),
    onMutate: () => {
      setError('');
      setEmpty(false);
      setExportId(null);
    },
    onSuccess: (outcome) => {
      void client.invalidateQueries({ queryKey: exportKeys.list(projectId) });
      if (outcome.kind === 'queued') {
        client.setQueryData(exportKeys.one(outcome.exported.id), outcome.exported);
        setExportId(outcome.exported.id);
        return;
      }
      setEmpty(outcome.empty);
      saveFile(outcome);
    },
    onError: (err) => setError(messageOf(err, 'No se pudo exportar. Inténtalo de nuevo.')),
  });

  const download = useMutation({
    mutationFn: (exported: Pick<Export, 'id' | 'fileName'>) => exportsApi.download(exported),
    onMutate: () => setError(''),
    onSuccess: saveFile,
    onError: (err) => setError(messageOf(err, 'No se pudo descargar. Inténtalo de nuevo.')),
  });

  const exported = exportId ? current.data : undefined;
  return {
    request: request.mutate,
    download: download.mutate,
    /** Hay una solicitud en vuelo o una exportación en segundo plano sin terminar. */
    busy: request.isPending || active(exported),
    preparing: active(exported),
    ready: exported?.status === 'done' ? exported : undefined,
    failed: exported?.status === 'failed' ? exported : undefined,
    empty,
    error,
  };
}
