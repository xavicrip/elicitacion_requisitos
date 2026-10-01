import type { Activity, BBox, VersionWithActivities } from '@reqcanvas/shared';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { diagramKeys } from '../api';
import type { Point, Size } from '../workspace/camera/zoom';
import { useWorkspaceStore } from '../workspace/store';
import { isFormField } from '../workspace/useWorkspaceKeyboard';
import { ZoneShape } from '../workspace/ZoneShape';
import { activitiesApi, activityCache } from './api';
import {
  boxFromDrag,
  HANDLES,
  hitTest,
  isArrowKey,
  moveBox,
  nudgeBox,
  resizeBox,
  toPixels,
  type Handle,
} from './geometry';
import { TransitionArrows } from './TransitionArrows';
import { useAutosave } from './useAutosave';

type Drag =
  | { kind: 'draw'; start: Point }
  | { kind: 'move'; id: string; start: Point; box: BBox }
  | { kind: 'resize'; id: string; handle: Handle; box: BBox };

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function Zone({
  activity,
  image,
  selected,
  zoom,
}: {
  activity: Pick<Activity, 'bbox'>;
  image: Size;
  selected: boolean;
  zoom: number;
}) {
  const { x, y, width, height } = toPixels(activity.bbox, image);
  const handle = 8 / zoom;
  const handles: Record<Handle, [number, number]> = {
    nw: [x, y],
    n: [x + width / 2, y],
    ne: [x + width, y],
    e: [x + width, y + height / 2],
    se: [x + width, y + height],
    s: [x + width / 2, y + height],
    sw: [x, y + height],
    w: [x, y + height / 2],
  };
  return (
    <group>
      <ZoneShape
        bbox={activity.bbox}
        image={image}
        color="#2563eb"
        opacity={selected ? 0.3 : 0.15}
        borderColor={selected ? '#1e3a8a' : '#2563eb'}
      />
      {selected &&
        HANDLES.map((name) => (
          <mesh key={name} position={[handles[name][0], -handles[name][1], 1.5]}>
            <planeGeometry args={[handle, handle]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
    </group>
  );
}

/**
 * Editor de zonas sobre el canvas (US2): arrastrar sobre un área vacía crea una zona;
 * arrastrar una zona la mueve y sus 8 handles la redimensionan; las flechas la desplazan
 * (1 px, 10 px con Shift; `Esc` deselecciona en `useWorkspaceKeyboard`). Los cambios pasan por el guardado automático.
 */
export function EditorLayer({ versionId, image }: { versionId: string; image: Size }) {
  const queryClient = useQueryClient();
  const autosave = useAutosave();
  const { data: version } = useQuery<VersionWithActivities>({
    queryKey: diagramKeys.version(versionId),
    enabled: false,
  });
  const activities = version?.activities ?? [];
  const selectedKey = useWorkspaceStore((state) => state.selectedActivityKey);
  const select = useWorkspaceStore((state) => state.select);
  const zoom = useWorkspaceStore((state) => state.camera.zoom);
  const gl = useThree((state) => state.gl);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<BBox | null>(null);

  const toImage = (event: ThreeEvent<PointerEvent>): Point => ({
    x: event.point.x,
    y: -event.point.y,
  });
  const byKey = (key: string | null) => activities.find((activity) => activity.key === key);

  // Teclado: flechas para desplazar la zona seleccionada (1 px; 10 px con Shift).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isFormField(event.target)) return;
      const selected = activities.find((activity) => activity.key === selectedKey);
      if (!selected || !isArrowKey(event.key)) return;
      event.preventDefault();
      autosave.save(selected.id, {
        bbox: nudgeBox(selected.bbox, event.key, event.shiftKey, image),
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activities, selectedKey, autosave, image]);

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.target as unknown as Element).setPointerCapture?.(event.pointerId);
    const point = toImage(event);
    const hit = hitTest(activities, point, selectedKey, zoom, image);
    const target = hit && byKey(hit.key);
    if (hit?.kind === 'handle' && target) {
      drag.current = { kind: 'resize', id: target.id, handle: hit.handle, box: target.bbox };
    } else if (hit?.kind === 'zone' && target) {
      select(target.key);
      drag.current = { kind: 'move', id: target.id, start: point, box: target.bbox };
    } else {
      select(null);
      drag.current = { kind: 'draw', start: point };
    }
  };

  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const point = toImage(event);
    const current = drag.current;
    if (!current) {
      const hit = hitTest(activities, point, selectedKey, zoom, image);
      gl.domElement.style.cursor =
        hit?.kind === 'handle' ? CURSORS[hit.handle] : hit ? 'move' : 'crosshair';
      return;
    }
    if (current.kind === 'draw') {
      setPreview(boxFromDrag(current.start, point, image));
    } else if (current.kind === 'move') {
      const delta = { x: point.x - current.start.x, y: point.y - current.start.y };
      autosave.save(current.id, { bbox: moveBox(current.box, delta, image) });
    } else {
      autosave.save(current.id, { bbox: resizeBox(current.box, current.handle, point, image) });
    }
  };

  const onPointerUp = async (event: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    drag.current = null;
    (event.target as unknown as Element).releasePointerCapture?.(event.pointerId);
    if (current?.kind !== 'draw') return;
    setPreview(null);
    const bbox = boxFromDrag(current.start, toImage(event), image);
    if (!bbox) return;
    const created = await activitiesApi.create(versionId, {
      label: `Actividad ${activities.length + 1}`,
      type: 'action',
      bbox,
    });
    activityCache.add(queryClient, versionId, created);
    select(created.key);
  };

  return (
    <group>
      {/* Plano de captura, mayor que la imagen, para dibujar aunque el puntero salga de ella. */}
      <mesh
        position={[image.width / 2, -image.height / 2, 0.5]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => void onPointerUp(event)}
      >
        <planeGeometry args={[image.width * 3, image.height * 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {activities.map((activity) => (
        <Zone
          key={activity.key}
          activity={activity}
          image={image}
          zoom={zoom}
          selected={activity.key === selectedKey}
        />
      ))}
      {preview && <Zone activity={{ bbox: preview }} image={image} zoom={zoom} selected={false} />}
      <TransitionArrows activities={activities} image={image} zoom={zoom} />
    </group>
  );
}
