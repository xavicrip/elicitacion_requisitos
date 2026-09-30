import type { VersionWithActivities } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { diagramKeys } from '../api';
import { useWorkspaceStore } from '../workspace/store';
import { ActivityForm, TYPE_LABEL } from './ActivityForm';

/** Panel lateral del modo edit: actividades marcadas y formulario de la seleccionada. */
export function EditorPanel({ versionId }: { versionId: string }) {
  const { data: version } = useQuery<VersionWithActivities>({
    queryKey: diagramKeys.version(versionId),
    enabled: false,
  });
  const selectedKey = useWorkspaceStore((state) => state.selectedActivityKey);
  const select = useWorkspaceStore((state) => state.select);
  const activities = version?.activities ?? [];

  return (
    <aside className="space-y-4" aria-label="Editor de actividades">
      <p className="text-sm text-gray-600">
        Arrastra sobre la imagen para marcar una actividad. Mueve el diagrama con el botón derecho o
        la rueda.
      </p>
      <section>
        <h2 className="font-semibold">Actividades ({activities.length})</h2>
        <ul className="mt-2 space-y-1">
          {activities.map((activity) => (
            <li key={activity.key}>
              <button
                type="button"
                aria-pressed={activity.key === selectedKey}
                onClick={() => select(activity.key)}
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-gray-100 aria-pressed:bg-blue-100"
              >
                {activity.label}{' '}
                <span className="text-gray-600">· {TYPE_LABEL[activity.type]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selectedKey && activities.some((activity) => activity.key === selectedKey) && (
        <ActivityForm
          key={selectedKey}
          versionId={versionId}
          activityKey={selectedKey}
          onDeleted={() => select(null)}
        />
      )}
    </aside>
  );
}
