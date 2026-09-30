import type { Session } from '@reqcanvas/shared';
import { useAuthStore } from './auth-store';

/** Mismo origen que la app: Caddy (o Vite en desarrollo) reenvía /api a la API (research R2). */
const API_BASE = '/api';

/** Error con el formato del contrato (`{ code, message, fields }`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const { code, message, fields } = (await response.json()) as {
      code: string;
      message: string;
      fields?: Record<string, string>;
    };
    if (code && message) return new ApiError(response.status, code, message, fields);
  } catch {
    // Sin cuerpo JSON: p. ej., el proxy no llega a la API.
  }
  return new ApiError(
    response.status,
    'NETWORK_ERROR',
    'No se pudo conectar con el servidor. Inténtalo de nuevo.',
  );
}

function send(path: string, { method = 'GET', body }: Options): Promise<Response> {
  const headers = new Headers();
  const token = useAuthStore.getState().accessToken;
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let refreshing: Promise<boolean> | null = null;

/**
 * Renueva la sesión con la cookie `rt` (httpOnly). Las peticiones concurrentes que reciben un
 * 401 comparten el mismo refresco. Devuelve `false` y borra la sesión si no se pudo renovar.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        useAuthStore.getState().clear();
        return false;
      }
      useAuthStore.getState().setSession((await response.json()) as Session);
      return true;
    } catch {
      useAuthStore.getState().clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Llamada a la API. Tras un 401 refresca la sesión una sola vez y reintenta, de modo que la
 * caducidad del access token es transparente (spec: no se pierde el texto en edición).
 */
export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) response = await send(path, options);
  }
  if (!response.ok) throw await toApiError(response);
  // 204, o 202 del borrado de un proyecto: respuestas sin cuerpo.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
