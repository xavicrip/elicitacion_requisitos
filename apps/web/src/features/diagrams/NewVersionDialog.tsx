import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { diagramKeys, diagramsApi } from './api';
import { ACCEPT_ATTRIBUTE, checkFile } from './validation';

/**
 * Subida de una versión nueva (FR-008): nace en borrador con las actividades de la anterior;
 * los Participantes siguen viendo la publicada hasta que se publique la nueva.
 */
export function NewVersionDialog({
  projectId,
  diagramId,
}: {
  projectId: string;
  diagramId: string;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const fileId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  const close = () => {
    setOpen(false);
    setFile(null);
    setError('');
    setProgress(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = file ? checkFile(file) : 'Selecciona la imagen del diagrama.';
    setError(problem ?? '');
    if (problem || !file) return;
    setProgress(0);
    try {
      await diagramsApi.addVersion(diagramId, file, setProgress);
      await queryClient.invalidateQueries({ queryKey: diagramKeys.list(projectId) });
      close();
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : 'No se pudo subir la versión.');
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded border px-4 py-2">
        Subir versión nueva
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
        >
          <form
            noValidate
            onSubmit={submit}
            className="w-full max-w-md space-y-4 rounded bg-white p-6"
          >
            <h2 id={titleId} className="text-lg font-semibold">
              Subir versión nueva
            </h2>
            <p className="text-sm text-gray-600">
              Se copiarán las actividades de la versión actual. Los participantes seguirán viendo la
              versión publicada hasta que publiques la nueva.
            </p>
            <div className="space-y-1">
              <label htmlFor={fileId} className="block text-sm font-medium">
                Imagen (PNG, JPG o SVG, máx. 10 MB)
              </label>
              <input
                id={fileId}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <FormError>{error}</FormError>
            {progress !== null && (
              <progress
                aria-label="Progreso de la subida"
                max={100}
                value={progress}
                className="w-full"
              />
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={close} className="rounded border px-4 py-2">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={progress !== null}
                className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
              >
                Subir
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
