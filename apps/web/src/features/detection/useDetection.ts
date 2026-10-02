import type { DetectionEvents, DetectionJob, DetectionProgress, Relayed } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { diagramKeys } from '../diagrams/api';
import { useConnectionStore } from '../realtime/connection';
import type { RealtimeSocket } from '../realtime/socket';
import { detectionApi, detectionKeys, isRunning } from './api';

/** Sin socket conectado, el progreso se consulta cada 3 s (plan de la 006, ajuste 7). */
export const POLL_MS = 3_000;

type Listener = { on(name: string, h: unknown): unknown; off(name: string, h: unknown): unknown };

/**
 * Estado de la detección de una versión: la última detección, lanzarla y sus propuestas. El
 * progreso llega por el socket de la 005 (`detection.*` en la sala de la versión); sin conexión,
 * se consulta por REST mientras dure.
 */
export function useDetection(versionId: string, socket: RealtimeSocket | null) {
  const client = useQueryClient();
  const connected = useConnectionStore((state) => state.status === 'connected');

  const job = useQuery({
    queryKey: detectionKeys.job(versionId),
    queryFn: () => detectionApi.latest(versionId),
    refetchInterval: (query) => (isRunning(query.state.data) && !connected ? POLL_MS : false),
  });
  const proposals = useQuery({
    queryKey: detectionKeys.proposals(versionId),
    queryFn: () => detectionApi.proposals(versionId),
  });

  const start = useMutation({
    mutationFn: () => detectionApi.start(versionId),
    onSuccess: (created) => client.setQueryData(detectionKeys.job(versionId), created),
  });

  useEffect(() => {
    if (!socket) return;
    const listener = socket as unknown as Listener;
    const mine = (payload: { versionId: string }) => payload.versionId === versionId;
    const onProgress = (payload: Relayed<DetectionEvents['detection.progress']>) => {
      if (!mine(payload)) return;
      const progress: DetectionProgress = { stage: payload.stage, pct: payload.pct };
      client.setQueryData<DetectionJob | null>(detectionKeys.job(versionId), (current) =>
        current && current.id === payload.jobId
          ? { ...current, status: 'running', progress }
          : current,
      );
    };
    const onFinished = (payload: { versionId: string }) => {
      if (!mine(payload)) return;
      void client.invalidateQueries({ queryKey: detectionKeys.job(versionId) });
      void client.invalidateQueries({ queryKey: detectionKeys.proposals(versionId) });
    };
    // Otra pestaña (u otro Administrador) revisó una propuesta: lista y actividades al día.
    const onReviewed = (payload: { versionId: string }) => {
      if (!mine(payload)) return;
      void client.invalidateQueries({ queryKey: detectionKeys.proposals(versionId) });
      void client.invalidateQueries({ queryKey: diagramKeys.version(versionId) });
    };
    listener.on('detection.progress', onProgress);
    listener.on('detection.completed', onFinished);
    listener.on('detection.failed', onFinished);
    listener.on('proposal.reviewed', onReviewed);
    return () => {
      listener.off('detection.progress', onProgress);
      listener.off('detection.completed', onFinished);
      listener.off('detection.failed', onFinished);
      listener.off('proposal.reviewed', onReviewed);
    };
  }, [socket, versionId, client]);

  return { job: job.data ?? null, proposals: proposals.data, start };
}
