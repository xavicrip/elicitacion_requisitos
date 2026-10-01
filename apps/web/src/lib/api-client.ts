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
    /** Cuerpo de la respuesta: p. ej., la actividad actual en un 409 por `rev` desactualizado. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Sin cuerpo JSON: p. ej., el proxy no llega a la API.
  }
  const { code, message, fields } = (body ?? {}) as {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
  if (code && message) return new ApiError(response.status, code, message, fields, body);
  return new ApiError(
    response.status,
    body === undefined ? 'NETWORK_ERROR' : 'HTTP_ERROR',
    'No se pudo conectar con el servidor. Inténtalo de nuevo.',
    {},
    body,
  );
}

function send(path: string, { method = 'GET', body, headers: extra }: Options): Promise<Response> {
  const headers = new Headers(extra);
  const token = useAuthStore.getState().accessToken;
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
    // Las escrituras terminan aunque se recargue la página (guardado automático, FR-006).
    ...(method === 'GET' ? {} : { keepalive: true }),
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

/**
 * Lee un recurso binario de la API (imágenes de diagramas) con la sesión: `<img>` y las
 * texturas no pueden enviar el access token. `url` es la ruta del contrato (`/api/…`).
 */
export async function apiBlob(url: string): Promise<Blob> {
  const path = url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url;
  let response = await send(path, {});
  if (response.status === 401 && (await refreshSession())) response = await send(path, {});
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

function xhrUpload(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    const token = useAuthStore.getState().accessToken;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () =>
      reject(
        new ApiError(
          0,
          'NETWORK_ERROR',
          'No se pudo conectar con el servidor. Inténtalo de nuevo.',
        ),
      );
    xhr.send(form);
  });
}

/** Subida `multipart/form-data` con progreso (`fetch` no lo informa); refresca tras un 401. */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  let result = await xhrUpload(path, form, onProgress);
  if (result.status === 401 && (await refreshSession())) {
    result = await xhrUpload(path, form, onProgress);
  }
  if (result.status < 200 || result.status >= 300) {
    throw await toApiError(new Response(result.text || null, { status: result.status }));
  }
  return JSON.parse(result.text) as T;
}
