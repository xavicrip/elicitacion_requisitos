import type { BBox } from '@reqcanvas/shared';
import { Line } from '@react-three/drei';
import { toPixels } from '../editor/geometry';
import type { Size } from './camera/zoom';

/** Zona de una actividad en el mundo (1 unidad = 1 px de imagen, `y` hacia arriba), en z = 1. */
export function ZoneShape({
  bbox,
  image,
  color,
  opacity,
  borderColor = color,
  borderOpacity = 1,
}: {
  bbox: BBox;
  image: Size;
  color: string;
  opacity: number;
  borderColor?: string;
  borderOpacity?: number;
}) {
  const { x, y, width, height } = toPixels(bbox, image);
  const corners = [
    [x, -y, 0],
    [x + width, -y, 0],
    [x + width, -(y + height), 0],
    [x, -(y + height), 0],
    [x, -y, 0],
  ] as [number, number, number][];
  return (
    <group position={[0, 0, 1]}>
      <mesh position={[x + width / 2, -(y + height / 2), 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <Line
        points={corners}
        color={borderColor}
        lineWidth={2}
        transparent
        opacity={borderOpacity}
      />
    </group>
  );
}
