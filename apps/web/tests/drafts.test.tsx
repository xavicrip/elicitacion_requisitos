import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailForm } from '../src/features/details/DetailForm';
import { clearDraft, draftKey, loadDraft, saveDraft } from '../src/features/realtime/drafts';
import { json, mockApi } from './helpers/api';
import { detail, KEY } from './helpers/details';

// FR-007 de la 005 (data-model, plan ajuste 11): el borrador en edición sobrevive a la
// desconexión y a la recarga.

const props = { projectId: 'p1', diagramId: 'd1', activityKey: KEY, facets: undefined };
const values = {
  given: 'el cliente tiene productos',
  when: 'paga con tarjeta',
  then: 'confirma el pago',
  type: 'functional',
  priority: '',
  authorRole: '',
  tags: '',
};

function renderForm(extra: Partial<Parameters<typeof DetailForm>[0]> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <DetailForm {...props} {...extra} />
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('drafts', () => {
  it('guarda, lee y borra por diagrama y actividad (y detalle al editar)', () => {
    expect(draftKey('d1', KEY)).toBe(`draft:d1:${KEY}`);
    expect(draftKey('d1', KEY, 'x1')).toBe(`draft:d1:${KEY}:x1`);
    saveDraft(draftKey('d1', KEY), { values, rev: 3 });
    expect(loadDraft(draftKey('d1', KEY))).toMatchObject({ values, rev: 3 });
    clearDraft(draftKey('d1', KEY));
    expect(loadDraft(draftKey('d1', KEY))).toBeNull();
  });

  it('ignora los borradores de más de 7 días', () => {
    localStorage.setItem(
      draftKey('d1', KEY),
      JSON.stringify({ values, savedAt: Date.now() - 8 * 24 * 3600 * 1000 }),
    );
    expect(loadDraft(draftKey('d1', KEY))).toBeNull();
  });

  it('funciona aunque localStorage lance (navegación privada)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveDraft(draftKey('d1', KEY), { values })).not.toThrow();
    expect(loadDraft(draftKey('d1', KEY))).toBeNull();
    expect(() => clearDraft(draftKey('d1', KEY))).not.toThrow();
  });
});

describe('formulario de la 004 con borrador', () => {
  it('guarda lo escrito con debounce de 300 ms y lo restaura al volver a abrir', async () => {
    const { unmount } = renderForm();
    await userEvent.type(screen.getByLabelText('Cuando (acción)'), 'paga con tarjeta');
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(loadDraft(draftKey('d1', KEY))?.values.when).toBe('paga con tarjeta');
    unmount();
    renderForm();
    expect(screen.getByLabelText('Cuando (acción)')).toHaveValue('paga con tarjeta');
  });

  it('lo borra al guardar con éxito', async () => {
    mockApi({ [`POST /api/diagrams/d1/activities/${KEY}/details`]: () => json(201, detail()) });
    saveDraft(draftKey('d1', KEY), { values });
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar requisito' }));
    await vi.waitFor(() => expect(loadDraft(draftKey('d1', KEY))).toBeNull());
  });

  it('al editar, restaura el borrador y guarda con el rev con que se empezó', async () => {
    const api = mockApi({ 'PATCH /api/details/x1': () => json(200, detail({ rev: 1 })) });
    saveDraft(draftKey('d1', KEY, 'x1'), { values: { ...values, then: 'lo mío' }, rev: 0 });
    const editable = detail({
      rev: 4,
      permissions: { canEdit: true, canDelete: true, canVote: false, canModerate: false },
    });
    renderForm({ detail: editable });
    expect(screen.getByLabelText('Entonces (resultado)')).toHaveValue('lo mío');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await vi.waitFor(() =>
      expect(api.requests.find((r) => r.method === 'PATCH')?.ifMatch).toBe('"0"'),
    );
  });
});
