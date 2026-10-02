import type { ActivityProposal } from '@reqcanvas/shared';
import { imageToScreen, type Size } from '../diagrams/workspace/camera/zoom';
import { useWorkspaceStore } from '../diagrams/workspace/store';
import { TYPE_LABEL } from '../diagrams/labels';
import type { RealtimeSocket } from '../realtime/socket';
import { CONFIDENCE } from './labels';
import { useDetection } from './useDetection';

/**
 * Propuestas pendientes sobre el canvas (US1, research R7): capa HTML en coordenadas de imagen,
 * con borde discontinuo y la confianza como color, icono y texto. No bloquea el editor.
 */
export function ProposalsLayer({
  proposals,
  image,
}: {
  proposals: ActivityProposal[];
  image: Size;
}) {
  const camera = useWorkspaceStore((state) => state.camera);
  const viewport = useWorkspaceStore((state) => state.viewport);
  if (proposals.length === 0) return null;

  return (
    <div
      aria-label="Propuestas de la detección"
      role="list"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {proposals.map((proposal) => {
        const topLeft = imageToScreen(
          { x: proposal.bbox.x * image.width, y: proposal.bbox.y * image.height },
          camera,
          viewport,
        );
        const confidence = CONFIDENCE[proposal.confidenceLevel];
        const name = proposal.label || 'Sin nombre';
        return (
          <div
            key={proposal.id}
            role="listitem"
            data-testid="proposal"
            aria-label={`Propuesta: ${name} · ${TYPE_LABEL[proposal.type]} · ${confidence.label}`}
            className="absolute border-2 border-dashed"
            style={{
              left: topLeft.x,
              top: topLeft.y,
              width: proposal.bbox.w * image.width * camera.zoom,
              height: proposal.bbox.h * image.height * camera.zoom,
              borderColor: confidence.color,
            }}
          >
            <span
              className="absolute -top-5 left-0 rounded px-1 text-xs whitespace-nowrap text-white"
              style={{ backgroundColor: confidence.color }}
            >
              {confidence.icon} {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Propuestas pendientes de la versión, con su progreso en tiempo real. */
export function DetectionProposals({
  versionId,
  socket,
  image,
}: {
  versionId: string;
  socket: RealtimeSocket | null;
  image: Size;
}) {
  const { proposals } = useDetection(versionId, socket);
  return <ProposalsLayer proposals={proposals?.activities ?? []} image={image} />;
}
