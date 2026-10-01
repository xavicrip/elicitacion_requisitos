import type { ActivityCoverage } from '@reqcanvas/shared';
import { StickyNotes } from './StickyNotes';

/**
 * Indicador de una actividad en el canvas (FR-011): el número de requisitos, que despliega sus
 * notas, o la marca «Sin detalles» con texto e icono, no solo color (WCAG 1.4.1).
 */
export function CoverageBadge({
  coverage,
  notesOpen,
  onToggleNotes,
}: {
  coverage: ActivityCoverage;
  notesOpen: boolean;
  onToggleNotes: () => void;
}) {
  if (coverage.total === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs whitespace-nowrap text-gray-800">
        <span aria-hidden="true">∅</span>
        Sin detalles
      </span>
    );
  }
  return (
    <div className="pointer-events-auto">
      <button
        type="button"
        aria-expanded={notesOpen}
        aria-label={`${coverage.total} requisito(s): ${notesOpen ? 'ocultar' : 'mostrar'} notas`}
        onClick={onToggleNotes}
        className="min-w-6 rounded-full bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white"
      >
        {coverage.total}
      </button>
      {notesOpen && coverage.top.length > 0 && <StickyNotes top={coverage.top} />}
    </div>
  );
}
