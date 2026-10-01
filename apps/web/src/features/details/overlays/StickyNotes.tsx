import type { ActivityCoverage } from '@reqcanvas/shared';

/** Notas junto a la zona: los resúmenes de sus requisitos más votados (≤ 3, research R8). */
export function StickyNotes({ top }: { top: ActivityCoverage['top'] }) {
  return (
    <ul
      aria-label="Notas de los requisitos"
      className="mt-1 w-56 space-y-1 rounded border border-yellow-300 bg-yellow-50 p-2 text-xs shadow"
    >
      {top.map((note) => (
        <li key={note.id}>{note.summary}</li>
      ))}
    </ul>
  );
}
