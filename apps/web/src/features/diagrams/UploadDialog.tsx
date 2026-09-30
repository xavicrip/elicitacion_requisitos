import { zodResolver } from '@hookform/resolvers/zod';
import { DiagramInputSchema, type DiagramInput } from '@reqcanvas/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { applyApiError, Field, FormError } from '../../components/form';
import { diagramKeys, diagramsApi } from './api';
import { ACCEPT_ATTRIBUTE, checkFile } from './validation';

/** Subida de un diagrama nuevo (US1): nombre e imagen, con progreso. */
export function UploadDialog({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const titleId = useId();
  const fileId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const form = useForm<DiagramInput>({
    resolver: zodResolver(DiagramInputSchema),
    defaultValues: { name: '' },
  });

  const close = () => {
    setOpen(false);
    setFile(null);
    setFileError('');
    setError('');
    setProgress(null);
    form.reset();
  };

  const submit = form.handleSubmit(async ({ name }) => {
    setError('');
    const problem = file ? checkFile(file) : 'Selecciona la imagen del diagrama.';
    setFileError(problem ?? '');
    if (problem || !file) return;
    setProgress(0);
    try {
      const version = await diagramsApi.create(projectId, name, file, setProgress);
      await queryClient.invalidateQueries({ queryKey: diagramKeys.list(projectId) });
      navigate(`/proyectos/${projectId}/diagramas/${version.diagramId}`);
    } catch (err) {
      setProgress(null);
      setError(applyApiError(err, form.setError));
    }
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white"
      >
        Nuevo diagrama
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
        >
          <form
            noValidate
            onSubmit={submit}
            className="w-full max-w-md space-y-4 rounded bg-white p-6"
          >
            <h2 id={titleId} className="text-lg font-semibold">
              Nuevo diagrama
            </h2>
            <Field label="Nombre" error={form.formState.errors.name} {...form.register('name')} />
            <div className="space-y-1">
              <label htmlFor={fileId} className="block text-sm font-medium">
                Imagen (PNG, JPG o SVG, máx. 10 MB)
              </label>
              <input
                id={fileId}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                aria-invalid={fileError ? true : undefined}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setFileError('');
                }}
              />
              {fileError && (
                <p role="alert" className="text-sm text-red-700">
                  {fileError}
                </p>
              )}
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
    </div>
  );
}
