import type { Activity } from '@reqcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A11yActivityList } from '../src/features/diagrams/workspace/A11yActivityList';
import { hotspotAt } from '../src/features/diagrams/workspace/ActivityHotspots';
import { Minimap } from '../src/features/diagrams/workspace/Minimap';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { useWorkspaceEvents } from '../src/features/diagrams/workspace/useWorkspaceEvents';
import { useWorkspaceKeyboard } from '../src/features/diagrams/workspace/useWorkspaceKeyboard';

const image = { width: 4000, height: 3000 };
const activity = (key: string, label: string, bbox: Activity['bbox']): Activity => ({
  id: `id-${key}`,
  key,
  rev: 0,
  source: 'manual',
  label,
  type: 'action',
  bbox,
  next: [],
});
const grande = activity('k-grande', 'Proceso', { x: 0.1, y: 0.1, w: 0.6, h: 0.6 });
const pequena = activity('k-pequena', 'Validar pago', { x: 0.2, y: 0.2, w: 0.1, h: 0.1 });
const store = useWorkspaceStore;

beforeEach(() => {
  store.getState().reset();
  store.getState().open('v1', 'view');
  store.getState().setViewport({ width: 1000, height: 500 });
});
afterEach(() => vi.unstubAllGlobals());

describe('ActivityHotspots: qué zona se selecciona', () => {
  it('bajo el cursor elige la zona más pequeña; fuera de las zonas, ninguna', () => {
    expect(hotspotAt([grande, pequena], { x: 1000, y: 700 }, image)).toBe('k-pequena');
    expect(hotspotAt([grande, pequena], { x: 2500, y: 1800 }, image)).toBe('k-grande');
    expect(hotspotAt([grande, pequena], { x: 3900, y: 2900 }, image)).toBeNull();
  });
});

describe('Minimap (FR-009)', () => {
  function renderMinimap() {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Minimap thumbUrl={undefined} image={image} />
      </QueryClientProvider>,
    );
    return screen.getByRole('button', { name: 'Minimapa: haz clic para centrar la vista' });
  }

  it('un clic centra la cámara en el punto correspondiente de la imagen', () => {
    const minimap = renderMinimap();
    minimap.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 200, height: 150 }) as DOMRect;
    fireEvent.click(minimap, { clientX: 60, clientY: 95 });
    expect(store.getState().cameraCommand?.command).toEqual({
      type: 'center',
      point: { x: 1000, y: 1500 },
    });
  });

  it('dibuja el rectángulo de la parte visible', () => {
    store.getState().setCamera({ zoom: 1, center: { x: 2000, y: 1500 } });
    renderMinimap();
    const rect = screen.getByTestId('minimap-viewport');
    expect(rect.style.left).toBe('37.5%');
    expect(rect.style.width).toBe('25%');
  });
});

describe('A11yActivityList (FR-011, research R5)', () => {
  it('Tab lleva el foco a una actividad, la resalta y centra la cámara en ella', async () => {
    render(<A11yActivityList activities={[pequena, grande]} image={image} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Validar pago (Acción)' })).toHaveFocus();
    expect(store.getState().hoveredActivityKey).toBe('k-pequena');
    expect(store.getState().cameraCommand?.command).toEqual({
      type: 'center',
      point: { x: 1000, y: 750 },
    });
  });

  it('Enter selecciona y aria-live lo anuncia', async () => {
    render(<A11yActivityList activities={[pequena, grande]} image={image} />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(store.getState().selectedActivityKey).toBe('k-pequena');
    expect(screen.getByRole('status')).toHaveTextContent('Seleccionada: Validar pago');
    expect(screen.getByRole('button', { name: 'Validar pago (Acción)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('teclado del espacio de trabajo (contracts/canvas-ui.md)', () => {
  const command = () => store.getState().cameraCommand?.command;

  it('+ y - hacen zoom, 0 ajusta, las flechas desplazan y Esc deselecciona', async () => {
    renderHook(() => useWorkspaceKeyboard());
    await userEvent.keyboard('+');
    expect(command()).toEqual({ type: 'zoom', factor: 1.25 });
    await userEvent.keyboard('-');
    expect(command()).toEqual({ type: 'zoom', factor: 0.8 });
    await userEvent.keyboard('0');
    expect(command()).toEqual({ type: 'fit' });
    await userEvent.keyboard('{ArrowRight}');
    expect(command()).toEqual({ type: 'pan', dx: 50, dy: 0 });

    act(() => store.getState().select('k1'));
    await userEvent.keyboard('{Escape}');
    expect(store.getState().selectedActivityKey).toBeNull();
  });

  it('en modo edit con una zona seleccionada, las flechas son del editor (no desplazan)', async () => {
    store.getState().open('v1', 'edit');
    act(() => store.getState().select('k1'));
    renderHook(() => useWorkspaceKeyboard());
    await userEvent.keyboard('{ArrowRight}');
    expect(store.getState().cameraCommand).toBeNull();
  });

  it('no actúa mientras se escribe en un campo', async () => {
    renderHook(() => useWorkspaceKeyboard());
    render(<input aria-label="campo" />);
    await userEvent.click(screen.getByLabelText('campo'));
    await userEvent.keyboard('0');
    expect(store.getState().cameraCommand).toBeNull();
  });
});

describe('useWorkspaceEvents (punto de extensión de la 005)', () => {
  it('emite activity:selected y camera:changed', () => {
    const onEvent = vi.fn();
    renderHook(() => useWorkspaceEvents(onEvent));
    act(() => store.getState().select('k1'));
    act(() => store.getState().setCamera({ zoom: 2, center: { x: 1, y: 2 } }));
    expect(onEvent).toHaveBeenCalledWith({ type: 'activity:selected', key: 'k1' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'camera:changed',
      camera: { zoom: 2, center: { x: 1, y: 2 } },
    });
  });
});
