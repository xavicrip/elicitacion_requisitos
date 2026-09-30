import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exposeWorkspaceForE2E, useWorkspaceStore } from '../src/features/diagrams/workspace/store';

const store = useWorkspaceStore;

beforeEach(() => store.getState().reset());
afterEach(() => {
  delete window.__REQCANVAS_CONFIG__;
  delete window.__canvasState;
});

describe('store del espacio de trabajo (contracts/canvas-ui.md)', () => {
  it('open inicia una versión en el modo indicado, sin selección y sin imagen cargada', () => {
    store.getState().open('v1', 'edit');
    expect(store.getState()).toMatchObject({
      versionId: 'v1',
      mode: 'edit',
      selectedActivityKey: null,
      hoveredActivityKey: null,
      imageStatus: 'loading',
      overlays: {},
    });
  });

  it('selecciona, resalta y deselecciona actividades', () => {
    store.getState().open('v1', 'view');
    store.getState().select('k1');
    store.getState().hover('k2');
    expect(store.getState()).toMatchObject({ selectedActivityKey: 'k1', hoveredActivityKey: 'k2' });
    store.getState().select(null);
    expect(store.getState().selectedActivityKey).toBeNull();
  });

  it('abrir otra versión limpia la selección', () => {
    store.getState().open('v1', 'view');
    store.getState().select('k1');
    store.getState().open('v2', 'view');
    expect(store.getState()).toMatchObject({ versionId: 'v2', selectedActivityKey: null });
  });

  it('guarda la cámara, el estado de la imagen y las capas (puntos de extensión)', () => {
    store.getState().setCamera({ zoom: 0.5, center: { x: 10, y: 20 } });
    store.getState().setImageStatus('ready');
    store.getState().setOverlay('heatmap', true);
    expect(store.getState()).toMatchObject({
      camera: { zoom: 0.5, center: { x: 10, y: 20 } },
      imageStatus: 'ready',
      overlays: { heatmap: true },
    });
  });
});

describe('window.__canvasState (plan ajuste 8)', () => {
  it('no se expone sin e2eHooks en /config.js', () => {
    window.__REQCANVAS_CONFIG__ = { version: '1.0.0' };
    exposeWorkspaceForE2E();
    expect(window.__canvasState).toBeUndefined();
  });

  it('con e2eHooks, expone una instantánea de solo datos del estado actual', () => {
    window.__REQCANVAS_CONFIG__ = { e2eHooks: true };
    exposeWorkspaceForE2E();
    store.getState().open('v9', 'view');
    store.getState().select('k3');
    const snapshot = window.__canvasState;
    expect(snapshot).toMatchObject({ versionId: 'v9', mode: 'view', selectedActivityKey: 'k3' });
    expect(Object.values(snapshot ?? {}).some((value) => typeof value === 'function')).toBe(false);
  });
});
