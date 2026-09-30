import type { Project } from '@reqcanvas/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { projectKeys, projectsApi } from './api';

/**
 * Borrado con confirmación (US2 escenario 4): el botón solo se activa al escribir el nombre
 * exacto del proyecto, la misma comprobación que hace la API (`confirmName`).
 */
export function DeleteProjectDialog({ project }: { project: Project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const titleId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const close = () => {
    setOpen(false);
    setConfirmName('');
    setError('');
  };

  const confirm = async () => {
    setDeleting(true);
    try {
      await projectsApi.remove(project.id, confirmName);
      queryClient.removeQueries({ queryKey: projectKeys.detail(project.id) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
      navigate('/proyectos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el proyecto.');
      setDeleting(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-red-700 px-4 py-2 font-medium text-red-700"
      >
        Eliminar proyecto
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded bg-white p-6">
            <h2 id={titleId} className="text-lg font-semibold">
              Eliminar proyecto
            </h2>
            <p className="text-sm">
              Se eliminarán el proyecto y todo su contenido (diagramas, requisitos y análisis). Esta
              acción no se puede deshacer.
            </p>
            <FormError>{error}</FormError>
            <div className="space-y-1">
              <label htmlFor={inputId} className="block text-sm">
                Escribe <strong>{project.name}</strong> para confirmar
              </label>
              <input
                id={inputId}
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                autoComplete="off"
                className="w-full rounded border px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={close} className="rounded border px-4 py-2">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={confirmName !== project.name || deleting}
                className="rounded bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
              >
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
