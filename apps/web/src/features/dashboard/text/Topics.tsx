import type { AnalysisResults } from '@reqcanvas/shared';
import { DetailSnippet, type Lookup } from './lookup';

type TopicList = NonNullable<AnalysisResults['topics']>;

/**
 * Temas transversales (US2-3): cada uno con sus términos representativos, el número de detalles
 * y las actividades donde aparece.
 */
export function Topics({ topics, lookup }: { topics: TopicList; lookup: Lookup }) {
  if (topics.length === 0) return <p>No se encontraron temas claros en estos detalles.</p>;
  return (
    <ul aria-label="Temas" className="space-y-3">
      {topics.map((topic, index) => (
        <li
          key={topic.id}
          aria-label={`Tema ${index + 1}`}
          className="space-y-1 rounded border p-3"
        >
          <h3 className="font-semibold">
            Tema {index + 1}: {topic.label}
          </h3>
          <p className="text-sm">
            {topic.detailIds.length} {topic.detailIds.length === 1 ? 'detalle' : 'detalles'} ·
            Actividades: {topic.activityKeys.map((key) => lookup.activityLabel(key)).join(', ')}
          </p>
          <p className="text-sm text-gray-600">
            Términos: {topic.terms.map((term) => term.term).join(', ')}
          </p>
          <details>
            <summary className="cursor-pointer text-sm underline">Ver sus detalles</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {topic.detailIds.map((id) => (
                <li key={id}>
                  <DetailSnippet id={id} lookup={lookup} />
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
