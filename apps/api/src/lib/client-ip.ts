import { isIP } from 'node:net';

type RequestLike = { ip: string; headers: Record<string, string | string[] | undefined> };

/**
 * IP del cliente para el rate limit y el bloqueo por origen (FR-004). `api` solo recibe
 * tráfico a través del borde de Railway, que pone `X-Real-IP` con la IP del cliente
 * (docs.railway.com, specs and limits), o del proxy de `web`, que la reenvía o, sin ella, pone
 * la de quien conecta. Sin una `X-Real-IP` válida se usa la IP de la conexión.
 */
export function clientIp(request: RequestLike): string {
  const header = request.headers['x-real-ip'];
  if (typeof header === 'string') {
    const value = header.trim();
    if (isIP(value)) return value;
  }
  return request.ip;
}
