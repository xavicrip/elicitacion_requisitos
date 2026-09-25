import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Servidor "analytics" simulado: responde /health con el estado indicado y registra cabeceras. */
export async function startFakeAnalytics(status = 200) {
  const received: IncomingHttpHeaders[] = [];
  const server: Server = createServer((req, res) => {
    received.push(req.headers);
    res
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: status === 200 ? 'ok' : 'degraded' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
