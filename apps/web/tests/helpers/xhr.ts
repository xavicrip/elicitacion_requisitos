import { vi } from 'vitest';

type Reply = { status: number; body?: unknown };

/** Petición registrada por `FakeXHR`: método, URL, cabeceras y cuerpo (FormData). */
export type SentUpload = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: FormData;
};

/**
 * `XMLHttpRequest` simulado para las subidas con progreso: responde en orden con `replies` y
 * emite un evento de progreso intermedio (50 %) antes de cada respuesta.
 */
export function mockUploads(replies: Reply[]) {
  const sent: SentUpload[] = [];
  let release: (() => void) | undefined;
  const gate = { hold: false, release: () => release?.() };

  class FakeXHR {
    status = 0;
    responseText = '';
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private request = { method: '', url: '', headers: {} as Record<string, string> };

    open(method: string, url: string) {
      this.request.method = method;
      this.request.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.request.headers[name.toLowerCase()] = value;
    }
    send(body: FormData) {
      sent.push({ ...this.request, body });
      const reply = replies.shift() ?? { status: 500 };
      const finish = () => {
        this.status = reply.status;
        this.responseText = reply.body === undefined ? '' : JSON.stringify(reply.body);
        this.onload?.();
      };
      setTimeout(() => {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 50,
          total: 100,
        } as ProgressEvent);
        if (gate.hold) release = finish;
        else setTimeout(finish, 0);
      }, 0);
    }
  }

  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  return { sent, gate };
}
