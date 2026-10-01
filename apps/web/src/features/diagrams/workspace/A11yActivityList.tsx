import type { Activity } from '@reqcanvas/shared';
import { TYPE_LABEL } from '../labels';
import type { Size } from './camera/zoom';
import { useWorkspaceStore } from './store';

const centerOf = ({ bbox }: Activity, image: Size) => ({
  x: (bbox.x + bbox.w / 2) * image.width,
  y: (bbox.y + bbox.h / 2) * image.height,
});

/**
 * Réplica accesible de las zonas (research R5, RNF-05): un canvas WebGL no es accesible. Al
 * tabular, la cámara va a la actividad y se resalta; `Enter` la selecciona y se anuncia.
 * Visualmente oculta salvo cuando tiene el foco.
 */
export function A11yActivityList({ activities, image }: { activities: Activity[]; image: Size }) {
  const selectedKey = useWorkspaceStore((state) => state.selectedActivityKey);
  const { select, hover, requestCamera } = useWorkspaceStore.getState();
  const selected = activities.find((activity) => activity.key === selectedKey);

  return (
    <nav aria-label="Actividades del diagrama">
      <ul className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:top-3 focus-within:left-3 focus-within:z-10 focus-within:max-h-[60%] focus-within:overflow-auto focus-within:rounded focus-within:bg-white focus-within:p-2 focus-within:shadow">
        {activities.map((activity) => (
          <li key={activity.key}>
            <button
              type="button"
              aria-pressed={activity.key === selectedKey}
              onFocus={() => {
                hover(activity.key);
                requestCamera({ type: 'center', point: centerOf(activity, image) });
              }}
              onBlur={() => hover(null)}
              onClick={() => select(activity.key)}
              className="w-full rounded px-2 py-1 text-left text-sm aria-pressed:bg-blue-100"
            >
              {activity.label} ({TYPE_LABEL[activity.type]})
            </button>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {selected ? `Seleccionada: ${selected.label}` : ''}
      </p>
    </nav>
  );
}
