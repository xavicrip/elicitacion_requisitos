import type { ActivityProposal, BBox, TransitionProposal } from '@reqcanvas/shared';
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
  transitions = [],
  image,
}: {
  proposals: ActivityProposal[];
  transitions?: TransitionProposal[];
  image: Size;
}) {
  const camera = useWorkspaceStore((state) => state.camera);
  const viewport = useWorkspaceStore((state) => state.viewport);
  if (proposals.length === 0 && transitions.length === 0) return null;
  const center = (bbox: BBox) =>
    imageToScreen(
      { x: (bbox.x + bbox.w / 2) * image.width, y: (bbox.y + bbox.h / 2) * image.height },
      camera,
      viewport,
    );

  return (
    <div
      aria-label="Propuestas de la detección"
      role="list"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {transitions.length > 0 && (
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <marker
              id="proposal-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L9,3 L0,6 z" fill="#B45309" />
            </marker>
          </defs>
          {transitions.map((transition) => {
            const from = center(transition.from.bbox);
            const to = center(transition.to.bbox);
            return (
              <line
                key={transition.id}
                data-testid="proposed-transition"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#B45309"
                strokeWidth={2}
                strokeDasharray="6 4"
                markerEnd="url(#proposal-arrow)"
              />
            );
          })}
        </svg>
      )}
      {transitions.map((transition) => (
        <span
          key={transition.id}
          role="listitem"
          className="sr-only"
        >{`Flecha propuesta: ${transition.from.label || 'Sin nombre'} → ${transition.to.label || 'Sin nombre'}`}</span>
      ))}
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
  return (
    <ProposalsLayer
      proposals={proposals?.activities ?? []}
      transitions={proposals?.transitions ?? []}
      image={image}
    />
  );
}
