import type { VersionWithActivities } from '@reqcanvas/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { diagramKeys, diagramsApi } from './api';
import { useAutosave } from './editor/useAutosave';

/** Publicar el borrador (FR-007): exige al menos una actividad; antes guarda lo pendiente. */
export function PublishButton({
  projectId,
  version,
}: {
  projectId: string;
  version: VersionWithActivities;
}) {
  const queryClient = useQueryClient();
  const autosave = useAutosave();
  const hintId = useId();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const empty = version.activities.length === 0;

  const publish = async () => {
    setPublishing(true);
    setError('');
    try {
      await autosave.flushAll();
      await diagramsApi.publish(version.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: diagramKeys.list(projectId) }),
        queryClient.invalidateQueries({ queryKey: diagramKeys.version(version.id) }),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo publicar el diagrama.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void publish()}
        disabled={empty || publishing}
        aria-describedby={empty ? hintId : undefined}
        className="rounded bg-green-700 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Publicar
      </button>
      {empty && (
        <p id={hintId} className="text-sm text-gray-600">
          Marca al menos una actividad para publicar.
        </p>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}
