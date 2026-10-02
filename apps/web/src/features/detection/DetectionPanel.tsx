import type { DetectionJob } from '@reqcanvas/shared';
import { ApiError } from '../../lib/api-client';
import { useCanWrite } from '../realtime/connection';
import type { RealtimeSocket } from '../realtime/socket';
import { isRunning } from './api';
import { STAGE_LABEL } from './labels';
import { useDetection } from './useDetection';

function Status({ job }: { job: DetectionJob }) {
  if (isRunning(job)) {
    return (
      <p role="status" className="text-sm">
        Detectando actividades… {STAGE_LABEL[job.progress.stage]} ({job.progress.pct} %). Puedes
        seguir trabajando mientras tanto.
      </p>
    );
  }
  if (job.status === 'failed') {
    return (
      <p role="alert" className="text-sm text-red-700">
        {job.error?.message ?? 'No se pudo completar la detección.'}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm">
      {job.metrics.proposed === 0
        ? 'No se encontraron actividades; marca las zonas manualmente.'
        : `Se propusieron ${job.metrics.proposed} zonas. Aparecen punteadas en el diagrama.`}
    </p>
  );
}

/**
 * Detección asistida en el panel del editor (US1, FR-001 y FR-002): lanzarla, su progreso por
 * etapas y el resultado o el error con *Reintentar*.
 */
export function DetectionPanel({
  versionId,
  socket,
}: {
  versionId: string;
  socket: RealtimeSocket | null;
}) {
  const { job, start } = useDetection(versionId, socket);
  const canWrite = useCanWrite();
  const running = isRunning(job);
  const error = start.error instanceof ApiError ? start.error.message : null;

  return (
    <section aria-label="Detección asistida" className="space-y-2 rounded border p-3">
      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={running || start.isPending || !canWrite}
        className="rounded border px-3 py-1 disabled:opacity-50"
      >
        {job?.status === 'failed' ? 'Reintentar' : 'Detectar actividades'}
      </button>
      {job && <Status job={job} />}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
