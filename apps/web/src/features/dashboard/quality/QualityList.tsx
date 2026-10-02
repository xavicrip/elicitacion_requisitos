import type { AnalysisInputDetail, AnalysisResults } from '@reqcanvas/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Lookup } from '../text/lookup';

type Quality = NonNullable<AnalysisResults['quality']>;
type Issue = Quality[number]['issues'][number];

const FIELD_LABEL = { given: 'Dado', when: 'Cuando', then: 'Entonces' } as const;
const ISSUE_LABEL: Record<Issue['code'], string> = {
  ambiguous_term: 'Término ambiguo',
  not_measurable: 'No es medible',
  too_short: 'Demasiado breve',
  missing_verb: 'Falta un verbo',
  vague_reference: 'Referencia vaga',
};
const PAGE = 25;

/** Resalta los términos señalados dentro del texto, sin interpretar HTML. */
function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text;
  const lower = text.toLowerCase();
  // Los términos del léxico van en su forma base: se busca la raíz común (rápido → rápid…).
  const stems = terms.map((term) => (term.length > 4 ? term.slice(0, -1) : term).toLowerCase());
  const parts: ReactNode[] = [];
  let index = 0;
  while (index < text.length) {
    const stem = stems.find((candidate) => lower.startsWith(candidate, index));
    const boundary = index === 0 || !/\p{L}/u.test(text[index - 1]!);
    if (stem && boundary) {
      let end = index + stem.length;
      while (end < text.length && /\p{L}/u.test(text[end]!)) end++;
      parts.push(<mark key={index}>{text.slice(index, end)}</mark>);
      index = end;
    } else {
      const last = parts.at(-1);
      if (typeof last === 'string') parts[parts.length - 1] = last + text[index];
      else parts.push(text[index]!);
      index++;
    }
  }
  return parts;
}

function Scenario({ detail, issues }: { detail: AnalysisInputDetail; issues: Issue[] }) {
  const termsOf = (field: keyof typeof FIELD_LABEL) =>
    issues
      .filter((issue) => issue.code === 'ambiguous_term' && issue.field === field && issue.term)
      .map((issue) => issue.term!);
  return (
    <p>
      {(Object.keys(FIELD_LABEL) as Array<keyof typeof FIELD_LABEL>).map((field) => (
        <span key={field}>
          <span className="font-medium">{FIELD_LABEL[field]}</span>{' '}
          {highlight(detail[field], termsOf(field))}.{' '}
        </span>
      ))}
    </p>
  );
}

/**
 * Calidad de los requisitos (US3): cada detalle con su puntaje y la explicación de cada problema,
 * ordenado por puntaje (primero los de menor calidad) y con el acceso para corregirlo.
 */
export function QualityList({ quality, lookup }: { quality: Quality; lookup: Lookup }) {
  const [ascending, setAscending] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const sorted = [...quality].sort(
    (a, b) =>
      (ascending ? a.score - b.score : b.score - a.score) || a.detailId.localeCompare(b.detailId),
  );
  const withIssues = quality.filter((item) => item.issues.length > 0).length;
  if (quality.length === 0) return <p>No hay detalles que evaluar.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {withIssues} de {quality.length} detalles tienen algo que mejorar.
        </p>
        <button
          type="button"
          onClick={() => setAscending((value) => !value)}
          className="rounded border px-3 py-1 text-sm"
        >
          Ordenar por puntaje: {ascending ? 'menor primero' : 'mayor primero'}
        </button>
      </div>
      <ol aria-label="Detalles por calidad" className="space-y-2">
        {sorted.slice(0, shown).map((item) => {
          const detail = lookup.detail(item.detailId);
          return (
            <li key={item.detailId} className="space-y-1 rounded border p-3 text-sm">
              <p className="font-semibold">
                Puntaje {item.score} de 100
                {detail && (
                  <span className="font-normal text-gray-600">
                    {' '}
                    · {lookup.activityLabel(detail.activityKey)}
                  </span>
                )}
              </p>
              {detail ? (
                <Scenario detail={detail} issues={item.issues} />
              ) : (
                <p className="text-gray-600">Detalle no disponible</p>
              )}
              {item.issues.length > 0 && (
                <ul className="list-disc pl-5">
                  {item.issues.map((issue, index) => (
                    <li key={index}>
                      {ISSUE_LABEL[issue.code]}
                      {issue.term ? ` «${issue.term}»` : ''}
                      {issue.field ? ` (${FIELD_LABEL[issue.field]})` : ''}
                      {issue.suggestion ? `: ${issue.suggestion}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {detail && (
                <Link
                  to={`/proyectos/${lookup.projectId}/diagramas/${detail.diagramId}`}
                  className="text-blue-700 underline"
                >
                  Ir al diagrama para corregirlo
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {shown < sorted.length && (
        <button
          type="button"
          onClick={() => setShown((value) => value + PAGE)}
          className="rounded border px-3 py-1 text-sm"
        >
          Mostrar más ({sorted.length - shown} restantes)
        </button>
      )}
    </div>
  );
}
