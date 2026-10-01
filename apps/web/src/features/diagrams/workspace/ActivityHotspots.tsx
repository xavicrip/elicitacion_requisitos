import type { Activity } from '@reqcanvas/shared';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, type ReactNode } from 'react';
import { hitTest, toPixels } from '../editor/geometry';
import type { Point, Size } from './camera/zoom';
import { useWorkspaceStore } from './store';
import { ZoneShape } from './ZoneShape';

const DEFAULT_COLOR = '#2563eb';
/** Un arrastre (desplazar la vista) no es un clic. */
const CLICK_TOLERANCE_PX = 4;

/** Una zona; memoizada para que resaltar otra no vuelva a renderizar las demás. */
const Hotspot = memo(function Hotspot({
  activity,
  image,
  selected,
  hovered,
  color,
  filled,
  badge,
}: {
  activity: Activity;
  image: Size;
  selected: boolean;
  hovered: boolean;
  color: string;
  /** Con `colorFor` (mapa de calor) la zona se rellena con opacidad 0,45 (research R8 de la 004). */
  filled: boolean;
  badge: ReactNode;
}) {
  const base = filled ? 0.45 : 0.06;
  const { x, y, width } = toPixels(activity.bbox, image);
  return (
    <group>
      <ZoneShape
        bbox={activity.bbox}
        image={image}
        color={color}
        opacity={selected ? base + 0.25 : hovered ? base + 0.15 : base}
        borderOpacity={selected || hovered ? 1 : 0.35}
      />
      {badge && (
        <Html position={[x + width, -y, 2]} style={{ pointerEvents: 'none' }}>
          {badge}
        </Html>
      )}
    </group>
  );
});

/** Actividad bajo un punto de la imagen: la zona más pequeña que lo contiene (research R5). */
export function hotspotAt(activities: Activity[], point: Point, image: Size): string | null {
  return hitTest(activities, point, null, 1, image)?.key ?? null;
}

export type HotspotExtensions = {
  /** Contenido junto a cada zona, p. ej. el contador de requisitos (004). */
  renderBadge?: (activity: Activity) => ReactNode;
  /** Color de cada zona, p. ej. el mapa de calor (004). */
  colorFor?: (activity: Activity) => string;
};

/**
 * Zonas seleccionables en modo vista (FR-009): resaltado con el nombre al pasar el cursor y
 * selección por clic o toque. Puntos de extensión `renderBadge` y `colorFor`
 * (contracts/canvas-ui.md).
 */
export function ActivityHotspots({
  activities,
  image,
  renderBadge,
  colorFor,
}: { activities: Activity[]; image: Size } & HotspotExtensions) {
  const hoveredKey = useWorkspaceStore((state) => state.hoveredActivityKey);
  const selectedKey = useWorkspaceStore((state) => state.selectedActivityKey);
  const { hover, select } = useWorkspaceStore.getState();
  const gl = useThree((state) => state.gl);
  const toImage = (event: ThreeEvent<PointerEvent | MouseEvent>) => ({
    x: event.point.x,
    y: -event.point.y,
  });

  const labelled = activities.filter(
    (activity) => activity.key === hoveredKey || activity.key === selectedKey,
  );

  return (
    <group>
      <mesh
        position={[image.width / 2, -image.height / 2, 0.5]}
        onPointerMove={(event) => {
          // Con un botón pulsado se está desplazando la vista: no se resalta (rendimiento).
          if (event.buttons !== 0) return;
          const key = hotspotAt(activities, toImage(event), image);
          if (key !== useWorkspaceStore.getState().hoveredActivityKey) hover(key);
          gl.domElement.style.cursor = key ? 'pointer' : '';
        }}
        onPointerOut={() => {
          hover(null);
          gl.domElement.style.cursor = '';
        }}
        onClick={(event) => {
          if (event.delta > CLICK_TOLERANCE_PX) return;
          select(hotspotAt(activities, toImage(event), image));
        }}
      >
        <planeGeometry args={[image.width * 3, image.height * 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {activities.map((activity) => (
        <Hotspot
          key={activity.key}
          activity={activity}
          image={image}
          selected={activity.key === selectedKey}
          hovered={activity.key === hoveredKey}
          color={colorFor?.(activity) ?? DEFAULT_COLOR}
          filled={Boolean(colorFor)}
          badge={renderBadge?.(activity)}
        />
      ))}

      {labelled.map((activity) => {
        const { x, y } = toPixels(activity.bbox, image);
        return (
          <Html
            key={`label-${activity.key}`}
            position={[x, -y, 3]}
            style={{ pointerEvents: 'none' }}
          >
            <span className="-translate-y-full inline-block rounded bg-gray-900/85 px-2 py-0.5 text-xs whitespace-nowrap text-white">
              {activity.label}
            </span>
          </Html>
        );
      })}
    </group>
  );
}
