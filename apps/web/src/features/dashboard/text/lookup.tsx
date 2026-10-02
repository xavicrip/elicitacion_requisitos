import type { AnalysisInputDetail, AnalysisRun } from '@reqcanvas/shared';
import { Link } from 'react-router';

/** Textos del conjunto analizado (junto a los resultados): detalles y nombres de actividad. */
export type Lookup = {
  projectId: string;
  detail: (id: string) => AnalysisInputDetail | undefined;
  activityLabel: (key: string) => string;
  /** Número de detalles analizados de una actividad. */
  detailsOf: (key: string) => number;
};

export function lookupOf(run: AnalysisRun): Lookup {
  const details = new Map((run.input?.details ?? []).map((detail) => [detail.id, detail]));
  const activities = new Map(
    (run.input?.activities ?? []).map((activity) => [activity.key, activity.label]),
  );
  return {
    projectId: run.projectId,
    detail: (id) => details.get(id),
    activityLabel: (key) => activities.get(key) ?? 'Actividad sin publicar',
    detailsOf: (key) =>
      (run.input?.details ?? []).filter((detail) => detail.activityKey === key).length,
  };
}

/** Un detalle analizado, como texto plano, con el acceso a su actividad en el diagrama. */
export function DetailSnippet({ id, lookup }: { id: string; lookup: Lookup }) {
  const detail = lookup.detail(id);
  if (!detail) return <span className="text-gray-600">Detalle no disponible</span>;
  return (
    <span>
      <span className="text-gray-600">{lookup.activityLabel(detail.activityKey)} · </span>
      Dado {detail.given}, cuando {detail.when}, entonces {detail.then}.{' '}
      <Link
        to={`/proyectos/${lookup.projectId}/diagramas/${detail.diagramId}`}
        className="text-blue-700 underline"
      >
        Ir al diagrama
      </Link>
    </span>
  );
}
