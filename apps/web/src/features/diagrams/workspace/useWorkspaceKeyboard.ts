import { useEffect } from 'react';
import { useWorkspaceStore } from './store';

const ZOOM_STEP = 1.25;
/** Desplazamiento de las flechas, en píxeles de pantalla. */
const PAN_STEP = 50;
const PAN: Record<string, [number, number]> = {
  ArrowLeft: [-PAN_STEP, 0],
  ArrowRight: [PAN_STEP, 0],
  ArrowUp: [0, -PAN_STEP],
  ArrowDown: [0, PAN_STEP],
};

export const isFormField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);

/**
 * Atajos de navegación (contracts/canvas-ui.md): `+`/`-` zoom, `0` ajustar, flechas para
 * desplazar y `Esc` para deseleccionar. En modo edit, con una zona seleccionada, las flechas
 * la mueven (lo hace el editor).
 */
export function useWorkspaceKeyboard() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isFormField(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const { mode, selectedActivityKey, requestCamera, select } = useWorkspaceStore.getState();
      if (event.key === 'Escape') {
        select(null);
      } else if (event.key === '+' || event.key === '=') {
        requestCamera({ type: 'zoom', factor: ZOOM_STEP });
      } else if (event.key === '-') {
        requestCamera({ type: 'zoom', factor: 1 / ZOOM_STEP });
      } else if (event.key === '0') {
        requestCamera({ type: 'fit' });
      } else if (PAN[event.key] && !(mode === 'edit' && selectedActivityKey)) {
        const [dx, dy] = PAN[event.key]!;
        requestCamera({ type: 'pan', dx, dy });
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
