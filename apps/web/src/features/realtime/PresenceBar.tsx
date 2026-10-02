import type { PresenceEntry } from '@reqcanvas/shared';

/** Personas conectadas al diagrama, con su nombre y color (US2, FR-003). */
export function PresenceBar({ entries, userId }: { entries: PresenceEntry[]; userId: string }) {
  const others = entries.filter((entry) => entry.userId !== userId);
  return (
    <section aria-label="Presencia" className="flex items-center gap-2 text-sm">
      <span className="text-gray-600">Conectados:</span>
      {others.length === 0 ? (
        <span className="text-gray-500">Nadie más conectado</span>
      ) : (
        <ul aria-label="Personas conectadas" className="flex flex-wrap gap-2">
          {others.map((entry) => (
            <li key={entry.userId} className="flex items-center gap-1">
              <span
                data-testid="presence-color"
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
