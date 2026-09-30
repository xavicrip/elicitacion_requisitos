import type { Activity, ActivityPatch } from '@reqcanvas/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api-client';
import { activitiesApi, activityCache } from './api';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export const CONFLICT_MESSAGE = 'Otro administrador modificó esta actividad';
/** Espera tras el último cambio antes de guardar (FR-006: guardado automático). */
export const AUTOSAVE_DELAY_MS = 500;

type Pending = { patch: ActivityPatch; timer?: ReturnType<typeof setTimeout>; saving: boolean };
type State = { status: SaveStatus; conflict: string | null; conflicts: number };

/**
 * Guardado automático del editor: aplica cada cambio a la caché al instante, agrupa los de una
 * actividad durante 500 ms y los envía con `If-Match` y el último `rev` guardado. Un 409 (otro
 * administrador guardó antes) recarga la actividad y avisa. Un solo PATCH por actividad a la vez.
 */
function createAutosaver(
  queryClient: QueryClient,
  versionId: string,
  setState: (update: (state: State) => State) => void,
) {
  const pending = new Map<string, Pending>();
  /** `rev` del servidor: la caché lleva los cambios locales, pero no inventa revisiones. */
  const entry = (id: string) => {
    let current = pending.get(id);
    if (!current) {
      current = { patch: {}, saving: false };
      pending.set(id, current);
    }
    return current;
  };

  /** Hay cambios sin confirmar por el servidor en alguna actividad. */
  const busy = () =>
    [...pending.values()].some((item) => item.saving || Object.keys(item.patch).length > 0);

  async function flush(id: string) {
    const current = entry(id);
    clearTimeout(current.timer);
    if (current.saving || Object.keys(current.patch).length === 0) return;
    const activity = activityCache.get(queryClient, versionId, id);
    if (!activity) return;
    const patch = current.patch;
    current.patch = {};
    current.saving = true;
    setState((state) => ({ ...state, status: 'saving' }));
    try {
      const saved = await activitiesApi.update(id, activity.rev, patch);
      // Lo que se escribió mientras tanto sigue pendiente y se conserva en pantalla.
      activityCache.update(queryClient, versionId, id, () => ({ ...saved, ...current.patch }));
      current.saving = false;
      setState((state) => ({ ...state, status: busy() ? 'saving' : 'saved' }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.body) {
        current.patch = {};
        activityCache.update(queryClient, versionId, id, () => error.body as Activity);
        setState((state) => ({
          status: 'idle',
          conflict: CONFLICT_MESSAGE,
          conflicts: state.conflicts + 1,
        }));
      } else {
        // Se reintenta con el siguiente cambio.
        current.patch = { ...patch, ...current.patch };
        setState((state) => ({ ...state, status: 'error' }));
      }
    } finally {
      current.saving = false;
    }
    if (Object.keys(current.patch).length > 0) schedule(id);
  }

  function schedule(id: string) {
    const current = entry(id);
    clearTimeout(current.timer);
    current.timer = setTimeout(() => void flush(id), AUTOSAVE_DELAY_MS);
  }

  return {
    save(id: string, patch: ActivityPatch) {
      activityCache.update(queryClient, versionId, id, (activity) => ({ ...activity, ...patch }));
      const current = entry(id);
      current.patch = { ...current.patch, ...patch };
      setState((state) => ({ ...state, status: 'saving', conflict: null }));
      schedule(id);
    },
    /** Descarta lo pendiente (p. ej., antes de eliminar la actividad). */
    discard(id: string) {
      clearTimeout(pending.get(id)?.timer);
      pending.delete(id);
    },
    flushAll: () => Promise.all([...pending.keys()].map(flush)),
    busy,
    dispose() {
      for (const current of pending.values()) clearTimeout(current.timer);
    },
  };
}

type Autosave = ReturnType<typeof createAutosaver> & State & { dismissConflict: () => void };

const AutosaveContext = createContext<Autosave | null>(null);

export function AutosaveProvider({
  versionId,
  children,
}: {
  versionId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ status: 'idle', conflict: null, conflicts: 0 });
  const [saver] = useState(() => createAutosaver(queryClient, versionId, setState));
  useEffect(() => {
    // Al recargar o cerrar la pestaña se envía lo pendiente (las peticiones van con keepalive).
    const onUnload = () => void saver.flushAll();
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      // Al salir del editor se guarda lo pendiente en lugar de perderlo.
      void saver.flushAll();
      saver.dispose();
    };
  }, [saver]);
  const value: Autosave = {
    ...saver,
    ...state,
    dismissConflict: () => setState((current) => ({ ...current, conflict: null })),
  };
  return <AutosaveContext.Provider value={value}>{children}</AutosaveContext.Provider>;
}

export function useAutosave(): Autosave {
  const autosave = useContext(AutosaveContext);
  if (!autosave) throw new Error('useAutosave requiere AutosaveProvider');
  return autosave;
}
