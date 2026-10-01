import type { MouseEvent } from 'react';
import { useImageUrl } from '../api';
import { viewportRect, type Size } from './camera/zoom';
import { useWorkspaceStore } from './store';

const WIDTH_PX = 176;
const percent = (value: number) => `${+(value * 100).toFixed(4)}%`;

/** Minimapa (research R4): miniatura con la parte visible; un clic centra la vista ahí. */
export function Minimap({ thumbUrl, image }: { thumbUrl: string | undefined; image: Size }) {
  const src = useImageUrl(thumbUrl);
  const camera = useWorkspaceStore((state) => state.camera);
  const viewport = useWorkspaceStore((state) => state.viewport);
  const requestCamera = useWorkspaceStore((state) => state.requestCamera);
  const rect =
    viewport.width > 0 ? viewportRect(camera, viewport, image) : { x: 0, y: 0, w: 1, h: 1 };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nx = (event.clientX - bounds.left) / bounds.width;
    const ny = (event.clientY - bounds.top) / bounds.height;
    requestCamera({ type: 'center', point: { x: nx * image.width, y: ny * image.height } });
  };

  return (
    <button
      type="button"
      aria-label="Minimapa: haz clic para centrar la vista"
      onClick={onClick}
      className="absolute right-3 bottom-3 overflow-hidden rounded border border-gray-400 bg-white/90 shadow"
      style={{ width: WIDTH_PX, aspectRatio: `${image.width} / ${image.height}` }}
    >
      {src && <img src={src} alt="" className="h-full w-full" draggable={false} />}
      <span
        data-testid="minimap-viewport"
        aria-hidden="true"
        className="pointer-events-none absolute border-2 border-blue-600 bg-blue-600/10"
        style={{
          left: percent(rect.x),
          top: percent(rect.y),
          width: percent(rect.w),
          height: percent(rect.h),
        }}
      />
    </button>
  );
}
