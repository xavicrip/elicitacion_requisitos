import type { Detail, DetailInput } from '@reqcanvas/shared';
import { diffWords } from 'diff';
import { useId } from 'react';
import { DETAIL_TYPE_LABEL, PRIORITY_LABEL } from './labels';

type Comparable = Pick<
  Detail,
  'given' | 'when' | 'then' | 'type' | 'priority' | 'authorRole' | 'tags'
>;

const FIELDS: Array<{ label: string; text: (value: Comparable) => string }> = [
  { label: 'Dado', text: (value) => value.given },
  { label: 'Cuando', text: (value) => value.when },
  { label: 'Entonces', text: (value) => value.then },
  { label: 'Tipo', text: (value) => DETAIL_TYPE_LABEL[value.type] },
  { label: 'Prioridad', text: (value) => (value.priority ? PRIORITY_LABEL[value.priority] : '—') },
  { label: 'Rol', text: (value) => value.authorRole ?? '—' },
  { label: 'Etiquetas', text: (value) => value.tags.join(', ') || '—' },
];

/** Texto con las diferencias resaltadas: lo añadido en una versión, lo quitado en la otra. */
function Diff({ from, to, show }: { from: string; to: string; show: 'added' | 'removed' }) {
  return (
    <>
      {diffWords(from, to).map((part, index) => {
        if (part.added && show === 'added') {
          return (
            <ins key={index} className="bg-green-100 no-underline">
              {part.value}
            </ins>
          );
        }
        if (part.removed && show === 'removed') {
          return (
            <del key={index} className="bg-red-100 no-underline">
              {part.value}
            </del>
          );
        }
        return part.added || part.removed ? null : <span key={index}>{part.value}</span>;
      })}
    </>
  );
}

/**
 * Otra persona guardó el requisito mientras se editaba (FR-007, research R2): compara campo a
 * campo la versión propia con la actual y deja elegir; nada se pierde en silencio.
 */
export default function ConflictDialog({
  mine,
  current,
  saving,
  onKeepMine,
  onUseCurrent,
}: {
  mine: DetailInput;
  current: Detail;
  saving: boolean;
  onKeepMine: () => void;
  onUseCurrent: () => void;
}) {
  const titleId = useId();
  const own: Comparable = {
    given: mine.given,
    when: mine.when,
    then: mine.then,
    type: mine.type,
    priority: mine.priority ?? null,
    authorRole: mine.authorRole ?? null,
    tags: mine.tags ?? [],
  };
  const changed = FIELDS.filter((field) => field.text(own) !== field.text(current));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="max-h-full w-full max-w-2xl space-y-4 overflow-auto rounded bg-white p-6 text-sm">
        <h2 id={titleId} className="text-lg font-semibold">
          Otra persona modificó este requisito
        </h2>
        <p>Compara tu versión con la actual y elige cuál conservar.</p>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="text-left">
              <th className="w-24" scope="col">
                Campo
              </th>
              <th scope="col">Tu versión</th>
              <th scope="col">Versión actual</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((field) => (
              <tr key={field.label} className="border-t align-top">
                <th scope="row" className="py-2 text-left font-medium">
                  {field.label}
                </th>
                <td className="py-2 pr-2">
                  <Diff from={field.text(current)} to={field.text(own)} show="added" />
                </td>
                <td className="py-2">
                  <Diff from={field.text(own)} to={field.text(current)} show="added" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onUseCurrent} className="rounded border px-4 py-2">
            Usar la versión actual
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            disabled={saving}
            className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Conservar lo mío
          </button>
        </div>
      </div>
    </div>
  );
}
