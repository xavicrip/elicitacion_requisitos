import type { ActivityCoverage } from '@reqcanvas/shared';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CoverageBadge } from '../src/features/details/overlays/CoverageBadges';
import { coverageHotspots, heatmapScale } from '../src/features/details/overlays/Heatmap';
import { useWorkspaceStore } from '../src/features/diagrams/workspace/store';
import { json } from './helpers/api';
import {
  activity,
  detail,
  DETAILS_URL,
  KEY,
  renderWorkspace,
  selectActivity,
  useDetailsTestSession,
} from './helpers/details';

useDetailsTestSession();

const entry = (overrides: Partial<ActivityCoverage> = {}): ActivityCoverage => ({
  activityKey: KEY,
  total: 4,
  byStatus: { pending: 3, validated: 1, duplicate: 0, discarded: 0 },
  effectiveVotes: 5,
  top: [
    { id: 'x1', summary: 'Cuando paga con tarjeta → Entonces confirma el pago' },
    { id: 'x2', summary: 'Cuando el pago falla → Entonces avisa al cliente' },
  ],
  ...overrides,
});

describe('escala del mapa de calor (research R8)', () => {
  it('agrupa por cuantiles del número de detalles, con su leyenda', () => {
    const scale = heatmapScale([0, 0, 0, 1, 2, 3, 5, 8]);
    expect(scale.legend.map((item) => item.label)).toEqual(['0', '1', '2–3', '4–8']);
    expect(scale.colorOf(0)).toBe(scale.legend[0]!.color);
    expect(scale.colorOf(2)).toBe(scale.legend[2]!.color);
    expect(scale.colorOf(8)).toBe(scale.legend[3]!.color);
    // De menos a más aportes: amarillo → rojo (YlOrRd).
    expect(scale.legend[0]!.color).toBe(interpolateYlOrRd(0.1));
    expect(scale.legend[3]!.color).toBe(interpolateYlOrRd(0.9));
  });

  it('sin detalles en ninguna actividad hay una sola clase', () => {
    expect(heatmapScale([0, 0]).legend).toEqual([{ label: '0', color: interpolateYlOrRd(0.1) }]);
  });
});

describe('coverageHotspots (renderBadge y colorFor de la 003)', () => {
  const coverage = [entry(), entry({ activityKey: 'otra', total: 0, top: [] })];

  it('colorFor solo existe con la capa heatmap activa', () => {
    const off = coverageHotspots(coverage, {
      heatmap: false,
      openNotes: new Set(),
      toggleNotes: () => {},
    });
    expect(off.colorFor).toBeUndefined();
    const on = coverageHotspots(coverage, {
      heatmap: true,
      openNotes: new Set(),
      toggleNotes: () => {},
    });
    expect(on.colorFor!(activity)).toBe(heatmapScale([4, 0]).colorOf(4));
  });

  it('sin cobertura todavía no hay indicadores', () => {
    const none = coverageHotspots(undefined, {
      heatmap: true,
      openNotes: new Set(),
      toggleNotes: () => {},
    });
    expect(none.renderBadge).toBeUndefined();
    expect(none.colorFor).toBeUndefined();
  });
});

describe('contador y notas de una actividad (FR-011)', () => {
  it('con detalles muestra el contador; al desplegar, las notas, y se pueden contraer', async () => {
    let open = false;
    const { rerender } = render(
      <CoverageBadge coverage={entry()} notesOpen={open} onToggleNotes={() => (open = !open)} />,
    );
    const button = screen.getByRole('button', { name: '4 requisito(s): mostrar notas' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    rerender(
      <CoverageBadge coverage={entry()} notesOpen={open} onToggleNotes={() => (open = !open)} />,
    );
    const notes = screen.getByRole('list', { name: 'Notas de los requisitos' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(2);
    expect(notes).toHaveTextContent('Cuando paga con tarjeta → Entonces confirma el pago');
    expect(screen.getByRole('button', { name: '4 requisito(s): ocultar notas' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('sin detalles muestra la marca «Sin detalles» con texto e icono (WCAG 1.4.1)', () => {
    render(
      <CoverageBadge
        coverage={entry({ total: 0, top: [] })}
        notesOpen={false}
        onToggleNotes={() => {}}
      />,
    );
    expect(screen.getByText('Sin detalles')).toBeInTheDocument();
    expect(screen.getByText('∅')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('mapa de calor en el espacio de trabajo', () => {
  const COVERAGE_URL = 'GET /api/diagram-versions/v1/coverage';

  it('el botón activa la capa heatmap y muestra la leyenda', async () => {
    renderWorkspace({ [COVERAGE_URL]: () => json(200, [entry()]) });
    const panel = await screen.findByRole('complementary', { name: 'Requisitos' });
    const toggle = await within(panel).findByRole('button', { name: 'Mapa de calor' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(useWorkspaceStore.getState().overlays.heatmap).toBe(true);
    expect(
      within(panel).getByRole('list', { name: 'Leyenda del mapa de calor' }),
    ).toHaveTextContent('4');
  });

  it('la cobertura se vuelve a pedir tras registrar un detalle', async () => {
    const api = renderWorkspace({
      [COVERAGE_URL]: () => json(200, [entry()]),
      [DETAILS_URL]: () => json(200, []),
      [`POST /api/diagrams/d1/activities/${KEY}/details`]: () => json(201, detail()),
    });
    const panel = await selectActivity();
    const coverageCalls = () => api.requests.filter((r) => r.url.endsWith('/coverage')).length;
    await waitFor(() => expect(coverageCalls()).toBe(1));
    await userEvent.type(
      within(panel).getByLabelText('Dado (contexto)'),
      'el cliente tiene productos',
    );
    await userEvent.type(within(panel).getByLabelText('Cuando (acción)'), 'paga con tarjeta');
    await userEvent.type(within(panel).getByLabelText('Entonces (resultado)'), 'confirma el pago');
    await userEvent.click(within(panel).getByRole('button', { name: 'Guardar requisito' }));
    await waitFor(() => expect(coverageCalls()).toBe(2));
  });
});
