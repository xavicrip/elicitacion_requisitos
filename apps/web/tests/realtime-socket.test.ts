import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/lib/auth-store';

// Cliente de Socket.IO de la feature 005 (contracts/socket-events.md, research R2 y R4).

type Handler = (...args: unknown[]) => void;

/** Socket simulado: guarda los manejadores y las emisiones. */
class FakeSocket {
  handlers = new Map<string, Handler[]>();
  managerHandlers = new Map<string, Handler[]>();
  emitted: Array<[string, unknown]> = [];
  connected = false;
  connectCalls = 0;
  options: { auth: (cb: (data: object) => void) => void } & Record<string, unknown>;
  engineClosed = 0;
  io = {
    on: (name: string, handler: Handler) => this.add(this.managerHandlers, name, handler),
    engine: { close: () => void (this.engineClosed += 1) },
  };

  constructor(options: FakeSocket['options']) {
    this.options = options;
  }
  private add(map: Map<string, Handler[]>, name: string, handler: Handler) {
    map.set(name, [...(map.get(name) ?? []), handler]);
    return this;
  }
  on(name: string, handler: Handler) {
    return this.add(this.handlers, name, handler);
  }
  off() {
    return this;
  }
  emit(name: string, payload?: unknown) {
    this.emitted.push([name, payload]);
    return this;
  }
  connect() {
    this.connectCalls += 1;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.fire('disconnect', 'io client disconnect');
    return this;
  }
  fire(name: string, ...args: unknown[]) {
    if (name === 'connect') this.connected = true;
    for (const handler of this.handlers.get(name) ?? []) handler(...args);
  }
  fireManager(name: string, ...args: unknown[]) {
    for (const handler of this.managerHandlers.get(name) ?? []) handler(...args);
  }
  /** Lo que enviaría en el handshake. */
  async handshakeAuth() {
    return new Promise<object>((resolve) => this.options.auth(resolve));
  }
}

const created: FakeSocket[] = [];
// `io(options)` o `io(url, options)`: las opciones van al final.
const io = vi.fn((...args: unknown[]) => {
  const socket = new FakeSocket(args.at(-1) as FakeSocket['options']);
  created.push(socket);
  return socket;
});
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...args) }));

const refreshSession = vi.fn(async () => {
  useAuthStore.getState().setSession({
    accessToken: token(3600),
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
    expiresIn: 3600,
  });
  return true;
});
vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<object>()),
  refreshSession: () => refreshSession(),
}));

/** JWT sin firma válida pero con `exp`: el cliente solo lee la caducidad. */
function token(secondsLeft: number, sub = 'u1') {
  const payload = { sub, exp: Math.floor(Date.now() / 1000) + secondsLeft };
  return `x.${btoa(JSON.stringify(payload))}.y`;
}

const { acquireSocket, releaseSocket, resetSocketForTests, useRealtimeSocket } =
  await import('../src/features/realtime/socket');
const { useConnectionStore } = await import('../src/features/realtime/connection');

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: token(900),
    user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
    expiresIn: 900,
  });
});
afterEach(() => {
  resetSocketForTests();
  created.length = 0;
  io.mockClear();
  refreshSession.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

const renderSocketHook = () => renderHook(() => useRealtimeSocket());

describe('useRealtimeSocket', () => {
  it('crea el socket y lo libera al desmontar', async () => {
    const { result, unmount } = renderSocketHook();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(io).toHaveBeenCalledTimes(1);
    created[0]!.fire('connect');
    unmount();
    expect(created[0]!.connected).toBe(false);
  });
});

describe('socket de la pestaña', () => {
  it('uno solo por pestaña, solo WebSocket y con reconexión de 0,5 a 5 s', async () => {
    const first = await acquireSocket();
    const second = await acquireSocket();
    expect(first).toBe(second);
    expect(io).toHaveBeenCalledTimes(1);
    expect(created[0]!.options).toMatchObject({
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
  });

  it('envía el access token vigente en cada handshake', async () => {
    await acquireSocket();
    const current = useAuthStore.getState().accessToken;
    expect(await created[0]!.handshakeAuth()).toEqual({ token: current });
  });

  it('se desconecta cuando nadie lo usa', async () => {
    await acquireSocket();
    await acquireSocket();
    releaseSocket();
    expect(created[0]!.connected).toBe(false);
    created[0]!.fire('connect');
    releaseSocket();
    expect(created[0]!.connected).toBe(false);
  });
});

describe('estado de la conexión', () => {
  it('connecting → connected → disconnected → connecting (reintento)', async () => {
    await acquireSocket();
    const socket = created[0]!;
    expect(useConnectionStore.getState().status).toBe('connecting');
    socket.fire('connect');
    expect(useConnectionStore.getState().status).toBe('connected');
    socket.fire('disconnect', 'transport close');
    expect(useConnectionStore.getState().status).toBe('disconnected');
    socket.fireManager('reconnect_attempt', 1);
    expect(useConnectionStore.getState().status).toBe('connecting');
  });
});

describe('token', () => {
  it('ante unauthorized refresca la sesión y reintenta una vez', async () => {
    await acquireSocket();
    const socket = created[0]!;
    const before = socket.connectCalls;
    socket.fire('connect_error', new Error('unauthorized'));
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(socket.connectCalls).toBe(before + 1));
    socket.fire('connect_error', new Error('unauthorized'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().status).toBe('disconnected');
  });

  it('cuando el token se renueva, lo envía con auth:refresh', async () => {
    await acquireSocket();
    const socket = created[0]!;
    socket.fire('connect');
    const renewed = token(1800);
    useAuthStore.getState().setSession({
      accessToken: renewed,
      user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
      expiresIn: 900,
    });
    expect(socket.emitted).toContainEqual(['auth:refresh', { token: renewed }]);
  });

  it('renueva la sesión un minuto antes de que caduque el token', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    useAuthStore.getState().setSession({
      accessToken: token(120),
      user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
      expiresIn: 120,
    });
    await acquireSocket();
    created[0]!.fire('connect');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(refreshSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe('red del navegador', () => {
  it('al pasar a offline cierra el transporte para que se note al instante y reintente', async () => {
    await acquireSocket();
    const socket = created[0]!;
    socket.fire('connect');
    window.dispatchEvent(new Event('offline'));
    expect(socket.engineClosed).toBe(1);
  });

  it('al volver online intenta conectar si no lo está', async () => {
    await acquireSocket();
    const socket = created[0]!;
    const before = socket.connectCalls;
    window.dispatchEvent(new Event('online'));
    expect(socket.connectCalls).toBe(before + 1);
  });

  it('sin socket en uso no escucha la red', async () => {
    await acquireSocket();
    const socket = created[0]!;
    socket.fire('connect');
    releaseSocket();
    window.dispatchEvent(new Event('offline'));
    expect(socket.engineClosed).toBe(0);
  });
});
