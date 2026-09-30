import type { Activity } from '@reqcanvas/shared';
import { Line } from '@react-three/drei';
import type { Size } from '../workspace/camera/zoom';
import { arrowBetween } from './geometry';

const COLOR = '#1d4ed8';
/** Tamaño de la punta en píxeles de pantalla. */
const HEAD_PX = 12;

/** Flechas de las transiciones (FR-005), de borde a borde de las zonas. */
export function TransitionArrows({
  activities,
  image,
  zoom,
}: {
  activities: Activity[];
  image: Size;
  zoom: number;
}) {
  const byKey = new Map(activities.map((activity) => [activity.key, activity]));
  const head = HEAD_PX / zoom;
  return (
    <group position={[0, 0, 2]}>
      {activities.flatMap((from) =>
        from.next.flatMap((key) => {
          const to = byKey.get(key);
          if (!to) return [];
          const { start, end } = arrowBetween(from.bbox, to.bbox, image);
          const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
          const ux = (end.x - start.x) / length;
          const uy = (end.y - start.y) / length;
          const base = { x: end.x - ux * head, y: end.y - uy * head };
          // Coordenadas del mundo: `y` hacia arriba.
          const points = [
            [start.x, -start.y, 0],
            [end.x, -end.y, 0],
          ] as [number, number, number][];
          const tip = [
            [base.x - uy * head * 0.5, -(base.y + ux * head * 0.5), 0],
            [end.x, -end.y, 0],
            [base.x + uy * head * 0.5, -(base.y - ux * head * 0.5), 0],
          ] as [number, number, number][];
          return [
            <Line key={`${from.key}-${key}`} points={points} color={COLOR} lineWidth={2} />,
            <Line key={`${from.key}-${key}-tip`} points={tip} color={COLOR} lineWidth={2} />,
          ];
        }),
      )}
    </group>
  );
}
