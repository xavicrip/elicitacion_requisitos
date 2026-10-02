import type { AnalysisResults, Insight } from '@reqcanvas/shared';
import { DETAIL_TYPE_LABEL } from '../../details/labels';
import { DetailSnippet, type Lookup } from '../text/lookup';

type Evidence = Insight['evidence'][number];

const KPI_LABEL: Record<string, string> = {
  total_details: 'Total de detalles analizados',
  'status:validated': 'Detalles validados',
  covered_activities: 'Actividades con al menos un detalle',
  'quality:with_issues': 'Detalles con algo que mejorar en su redacción',
};

function kpiLabel(id: string): string {
  if (id.startsWith('type:')) {
    const type = id.slice(5) as keyof typeof DETAIL_TYPE_LABEL;
    return `Detalles de tipo ${DETAIL_TYPE_LABEL[type] ?? type}`;
  }
  return KPI_LABEL[id] ?? id;
}

function Item({
  evidence,
  results,
  lookup,
}: {
  evidence: Evidence;
  results: AnalysisResults;
  lookup: Lookup;
}) {
  switch (evidence.kind) {
    case 'detail':
      return <DetailSnippet id={evidence.id} lookup={lookup} />;
    case 'quality': {
      const quality = results.quality?.find((item) => item.detailId === evidence.id);
      return (
        <span>
          {quality && <span className="font-medium">Puntaje {quality.score} de 100 · </span>}
          <DetailSnippet id={evidence.id} lookup={lookup} />
        </span>
      );
    }
    case 'activity': {
      const count = lookup.detailsOf(evidence.id);
      return (
        <span>
          Actividad <span className="font-medium">{lookup.activityLabel(evidence.id)}</span>:{' '}
          {count} {count === 1 ? 'detalle' : 'detalles'}
        </span>
      );
    }
    case 'topic': {
      const topic = results.topics?.find((item) => item.id === evidence.id);
      return topic ? (
        <span>
          Tema <span className="font-medium">{topic.label}</span>: {topic.detailIds.length} detalles
        </span>
      ) : (
        <span className="text-gray-600">Tema no disponible</span>
      );
    }
    case 'rule': {
      const rule = results.association?.[Number(evidence.id)];
      return rule ? (
        <span>{rule.sentence}</span>
      ) : (
        <span className="text-gray-600">Patrón no disponible</span>
      );
    }
    case 'kpi':
      return <span>Indicador: {kpiLabel(evidence.id)}</span>;
  }
}

/**
 * Datos que sustentan un insight (US5-2, SC-006): cada evidencia citada, con el dato real del
 * análisis. Todo se muestra como texto plano.
 */
export function EvidenceDrawer({
  insight,
  results,
  lookup,
}: {
  insight: Insight;
  results: AnalysisResults;
  lookup: Lookup;
}) {
  return (
    <section aria-label="Datos que lo sustentan" className="rounded bg-gray-50 p-3 text-sm">
      <h4 className="font-semibold">Datos que lo sustentan</h4>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {insight.evidence.map((evidence) => (
          <li key={`${evidence.kind}:${evidence.id}`}>
            <Item evidence={evidence} results={results} lookup={lookup} />
          </li>
        ))}
      </ul>
    </section>
  );
}
