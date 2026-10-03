import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { FormError } from '../../../components/form';
import { ApiError } from '../../../lib/api-client';
import { dashboardApi, dashboardKeys } from '../api';

const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const two = (value: string | number) => String(value).padStart(2, '0');

/** `30 2 * * *` → `02:30`; una programación que no sea diaria no se puede editar aquí. */
function timeOf(cron: string): string | null {
  const match = DAILY.exec(cron);
  return match ? `${two(match[2]!)}:${two(match[1]!)}` : null;
}

function cronOf(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${minutes} ${hours} * * *`;
}

/**
 * Análisis programado (FR-013): cada noche, a la hora elegida, se analiza el proyecto si sus
 * detalles cambiaron desde el último análisis. Está desactivado por defecto.
 */
export function ScheduleSettings({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const ids = { panel: useId(), enabled: useId(), time: useId() };
  const [open, setOpen] = useState(false);
  const settings = useQuery({
    queryKey: dashboardKeys.settings(projectId),
    queryFn: () => dashboardApi.settings(projectId),
    enabled: open,
  });
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('03:00');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.schedule.enabled);
    setTime(timeOf(settings.data.schedule.cron) ?? '03:00');
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      dashboardApi.saveSettings(projectId, {
        ...settings.data!,
        schedule: { ...settings.data!.schedule, enabled, cron: cronOf(time) },
      }),
    onMutate: () => {
      setError('');
      setMessage('');
    },
    onSuccess: (saved) => {
      client.setQueryData(dashboardKeys.settings(projectId), saved);
      setMessage(
        saved.schedule.enabled
          ? 'Guardado. El análisis se ejecutará cada noche si hay cambios.'
          : 'Guardado. El análisis automático está desactivado.',
      );
    },
    onError: (err) => {
      const fields = err instanceof ApiError ? Object.values(err.fields) : [];
      setError(fields[0] ?? (err instanceof ApiError ? err.message : 'No se pudo guardar.'));
    },
  });

  return (
    <div className="rounded border p-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={ids.panel}
        onClick={() => setOpen((value) => !value)}
        className="text-sm font-medium underline"
      >
        Análisis automático
      </button>
      {open && (
        <form
          id={ids.panel}
          onSubmit={(event) => {
            event.preventDefault();
            if (settings.data) save.mutate();
          }}
          className="mt-3 space-y-3"
        >
          {settings.error && <FormError>No se pudieron cargar los ajustes.</FormError>}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <input
                id={ids.enabled}
                type="checkbox"
                checked={enabled}
                disabled={!settings.data}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <label htmlFor={ids.enabled}>Analizar cada noche si hay cambios</label>
            </span>
            <span className="flex items-center gap-2">
              <label htmlFor={ids.time}>Hora</label>
              <input
                id={ids.time}
                type="time"
                required
                value={time}
                disabled={!settings.data || !enabled}
                onChange={(event) => setTime(event.target.value)}
                className="rounded border px-2 py-1"
              />
              {settings.data && (
                <span className="text-gray-600">({settings.data.schedule.timezone})</span>
              )}
            </span>
          </div>
          <button
            type="submit"
            disabled={!settings.data || save.isPending}
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
          >
            Guardar programación
          </button>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          <FormError>{error}</FormError>
        </form>
      )}
    </div>
  );
}
