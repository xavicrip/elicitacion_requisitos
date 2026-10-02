/**
 * Borradores del formulario de requisitos en `localStorage` (FR-007, data-model): sobreviven a
 * una desconexión y a una recarga. Todo acceso va en `try/catch`: en navegación privada o sin
 * espacio, el formulario funciona igual, sin borrador.
 */

export type Draft = {
  values: Record<string, string>;
  /** Al editar, el `rev` con que se empezó: guardar con él detecta los cambios de otros. */
  rev?: number;
  savedAt: number;
};

/** Se ignoran los borradores de más de 7 días. */
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** Uno por actividad para un requisito nuevo y uno por requisito al editar. */
export const draftKey = (diagramId: string, activityKey: string, detailId?: string) =>
  detailId ? `draft:${diagramId}:${activityKey}:${detailId}` : `draft:${diagramId}:${activityKey}`;

export function saveDraft(key: string, draft: Omit<Draft, 'savedAt'>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Sin almacenamiento disponible: no hay borrador.
  }
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (typeof draft?.savedAt !== 'number' || Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nada que borrar.
  }
}
