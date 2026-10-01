import {
  ActivityInputSchema,
  type ActivityType,
  type VersionWithActivities,
} from '@reqcanvas/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { FormError } from '../../../components/form';
import { ApiError } from '../../../lib/api-client';
import { diagramKeys } from '../api';
import { TYPE_LABEL } from '../labels';
import { activitiesApi, activityCache } from './api';
import { useAutosave } from './useAutosave';

const LabelSchema = ActivityInputSchema.shape.label;

const STATUS_TEXT = {
  idle: '',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'No se pudo guardar',
};

/**
 * Formulario de la actividad seleccionada (FR-004, FR-005): nombre, tipo y transiciones, con
 * guardado automático, y eliminación con confirmación si tiene requisitos asociados.
 */
export function ActivityForm({
  versionId,
  activityKey,
  onDeleted,
}: {
  versionId: string;
  activityKey: string;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const autosave = useAutosave();
  const { data: version } = useQuery<VersionWithActivities>({
    queryKey: diagramKeys.version(versionId),
    enabled: false,
  });
  const nameId = useId();
  const typeId = useId();
  const [nameError, setNameError] = useState('');
  const [dependents, setDependents] = useState<number | null>(null);
  const [error, setError] = useState('');

  const activity = version?.activities.find((candidate) => candidate.key === activityKey);

  // `Supr` elimina la actividad seleccionada (contracts/canvas-ui.md), fuera de los campos.
  const removeRef = useRef<(confirm: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field =
        event.target instanceof HTMLElement &&
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName);
      if (event.key === 'Delete' && !field) void removeRef.current(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!version || !activity) return null;
  const others = version.activities.filter((candidate) => candidate.key !== activityKey);

  const remove = async (confirm: boolean) => {
    autosave.discard(activity.id);
    try {
      await activitiesApi.remove(activity.id, confirm);
      activityCache.remove(queryClient, versionId, activity);
      setDependents(null);
      onDeleted();
    } catch (err) {
      const count =
        (err instanceof ApiError && (err.body as { detailCount?: number })?.detailCount) || 0;
      if (err instanceof ApiError && err.code === 'HAS_DEPENDENTS' && count > 0) {
        setDependents(count);
      } else {
        setError(err instanceof ApiError ? err.message : 'No se pudo eliminar la actividad.');
      }
    }
  };

  removeRef.current = remove;

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} aria-label="Actividad">
      <div className="space-y-1">
        <label htmlFor={nameId} className="block text-sm font-medium">
          Nombre
        </label>
        <input
          // Se vuelve a montar tras un conflicto para mostrar el nombre guardado por otra persona.
          key={`${activity.key}-${autosave.conflicts}`}
          id={nameId}
          defaultValue={activity.label}
          aria-invalid={nameError ? true : undefined}
          className="w-full rounded border px-3 py-2"
          onChange={(event) => {
            const parsed = LabelSchema.safeParse(event.target.value);
            setNameError(parsed.success ? '' : (parsed.error.issues[0]?.message ?? ''));
            if (parsed.success) autosave.save(activity.id, { label: parsed.data });
          }}
        />
        {nameError && (
          <p role="alert" className="text-sm text-red-700">
            {nameError}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={typeId} className="block text-sm font-medium">
          Tipo
        </label>
        <select
          id={typeId}
          value={activity.type}
          className="w-full rounded border px-3 py-2"
          onChange={(event) =>
            autosave.save(activity.id, { type: event.target.value as ActivityType })
          }
        >
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Va a</legend>
        {others.length === 0 && <p className="text-sm text-gray-600">No hay otras actividades.</p>}
        {others.map((other) => (
          <label key={other.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activity.next.includes(other.key)}
              onChange={(event) =>
                autosave.save(activity.id, {
                  next: event.target.checked
                    ? [...activity.next, other.key]
                    : activity.next.filter((key) => key !== other.key),
                })
              }
            />
            {other.label}
          </label>
        ))}
      </fieldset>

      {autosave.conflict && <FormError>{autosave.conflict}</FormError>}
      <FormError>{error}</FormError>
      <p aria-live="polite" className="text-sm text-gray-600">
        {STATUS_TEXT[autosave.status]}
      </p>

      <button
        type="button"
        onClick={() => void remove(false)}
        className="rounded border border-red-700 px-4 py-2 text-red-700"
      >
        Eliminar actividad
      </button>

      {dependents !== null && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar eliminación"
          className="space-y-3 rounded border border-red-300 bg-red-50 p-4"
        >
          <p>
            Esta actividad tiene {dependents} requisito(s) asociado(s). Si la eliminas, también se
            eliminarán.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDependents(null)}
              className="rounded border px-3 py-1"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void remove(true)}
              className="rounded bg-red-700 px-3 py-1 text-white"
            >
              Eliminar de todos modos
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
