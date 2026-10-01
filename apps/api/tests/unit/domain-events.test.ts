import { describe, expect, it, vi } from 'vitest';
import { createDomainEvents } from '../../src/lib/domain-events';

const base = {
  projectId: 'p1',
  diagramId: 'g1',
  actorId: 'u1',
  at: '2026-10-01T10:00:00.000Z',
};
const detail = {
  id: 'd1',
  diagramId: 'g1',
  activityKey: 'k1',
  given: 'el cliente tiene productos',
  when: 'paga con tarjeta',
  then: 'confirma el pago',
  type: 'functional' as const,
  priority: null,
  authorRole: null,
  tags: [],
  status: 'pending' as const,
  duplicateOf: null,
  discardReason: null,
  voteCount: 0,
  commentCount: 0,
  author: { id: 'u1', name: 'Luis' },
  rev: 0,
  createdAt: base.at,
  updatedAt: base.at,
};
const log = { warn: vi.fn() };

describe('bus de eventos de dominio (research R10 de la 004; plan de la 005, ajuste 4)', () => {
  it('entrega cada evento a sus suscriptores y a los de todos los eventos', async () => {
    const events = createDomainEvents(log);
    const created = vi.fn();
    const any = vi.fn();
    events.on('detail.created', created);
    events.onAny(any);
    await events.emit('detail.created', { ...base, detail });
    expect(created).toHaveBeenCalledWith({ ...base, detail });
    expect(any).toHaveBeenCalledWith('detail.created', { ...base, detail });
  });

  it('los payloads nunca llevan datos calculados por usuario', async () => {
    const events = createDomainEvents(log);
    const created = vi.fn();
    events.on('detail.created', created);
    await events.emit('detail.created', {
      ...base,
      detail: { ...detail, votedByMe: true, permissions: { canEdit: true } } as typeof detail,
    });
    const payload = created.mock.calls[0]![0] as { detail: Record<string, unknown> };
    expect(payload.detail).not.toHaveProperty('votedByMe');
    expect(payload.detail).not.toHaveProperty('permissions');

    const comment = vi.fn();
    events.on('comment.created', comment);
    await events.emit('comment.created', {
      ...base,
      comment: {
        id: 'c1',
        detailId: 'd1',
        text: 'hola',
        author: { id: 'u1', name: 'Luis' },
        createdAt: base.at,
        editedAt: null,
        permissions: { canEdit: true, canDelete: true },
      } as never,
    });
    expect(comment.mock.calls[0]![0].comment).not.toHaveProperty('permissions');
  });

  it('un suscriptor que falla no interrumpe a los demás y queda en el log', async () => {
    const events = createDomainEvents(log);
    const after = vi.fn();
    events.on('detail.deleted', () => {
      throw new Error('fallo del suscriptor');
    });
    events.on('detail.deleted', after);
    await events.emit('detail.deleted', { ...base, detailId: 'd1', activityKey: 'k1' });
    expect(after).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'detail.deleted' }),
      expect.any(String),
    );
  });

  it('on devuelve una función para darse de baja', async () => {
    const events = createDomainEvents(log);
    const listener = vi.fn();
    const off = events.on('vote.changed', listener);
    off();
    await events.emit('vote.changed', {
      ...base,
      detailId: 'd1',
      voteCount: 1,
      userId: 'u2',
      voted: true,
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('también entrega los eventos de diagramas, proyectos y miembros', async () => {
    const events = createDomainEvents(log);
    const any = vi.fn();
    events.onAny(any);
    const at = base.at;
    await events.emit('diagram.published', {
      projectId: 'p1',
      diagramId: 'g1',
      versionId: 'v2',
      actorId: 'u1',
      at,
    });
    await events.emit('project.status_changed', {
      projectId: 'p1',
      from: 'open',
      to: 'closed',
      actorId: 'u1',
      at,
    });
    await events.emit('member.removed', { projectId: 'p1', userId: 'u2', actorId: 'u1', at });
    await events.emit('member.left', { projectId: 'p1', userId: 'u2', actorId: 'u2', at });
    await events.emit('project.deleted', { projectId: 'p1', actorId: 'u1', at });
    expect(any.mock.calls.map(([name]) => name)).toEqual([
      'diagram.published',
      'project.status_changed',
      'member.removed',
      'member.left',
      'project.deleted',
    ]);
  });
});
