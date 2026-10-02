import { describe, expect, it } from 'vitest';
import { presenceState, type SocketPresence } from '../../src/realtime/presence';

// Estado de presencia a partir de un campo por socket (research R5 de la 005).

const now = 1_000_000;
const entry = (overrides: Partial<SocketPresence> = {}): SocketPresence => ({
  userId: 'u1',
  name: 'Ana',
  selectedActivityKey: null,
  selectedAt: 0,
  lastSeen: now,
  ...overrides,
});

describe('presenceState', () => {
  it('una persona con varias pestañas aparece una vez, con la última selección', () => {
    const state = presenceState(
      [
        entry({ selectedActivityKey: 'k1', selectedAt: 10 }),
        entry({ selectedActivityKey: 'k2', selectedAt: 20 }),
      ],
      now,
      10_000,
    );
    expect(state).toEqual([
      { userId: 'u1', name: 'Ana', color: expect.any(String), selectedActivityKey: 'k2' },
    ]);
  });

  it('ignora los sockets sin señal de vida en el plazo', () => {
    const state = presenceState(
      [entry(), entry({ userId: 'u2', name: 'Luis', lastSeen: now - 10_001 })],
      now,
      10_000,
    );
    expect(state.map((item) => item.userId)).toEqual(['u1']);
  });

  it('ordena por nombre y devuelve como mucho 50 personas', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      entry({ userId: `u${i}`, name: `Persona ${String(i).padStart(2, '0')}` }),
    );
    const state = presenceState(many.reverse(), now, 10_000);
    expect(state).toHaveLength(50);
    expect(state[0]!.name).toBe('Persona 00');
  });
});
