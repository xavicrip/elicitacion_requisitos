import { isOffline, useConnectionStore } from './connection';

/** Aviso de desconexión mientras el socket reintenta (US4 escenario 1, FR-006). */
export function ConnectionBanner() {
  const offline = useConnectionStore(isOffline);
  if (!offline) return null;
  return (
    <p role="alert" className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      Sin conexión: reintentando. Lo que escribas se conserva y podrás guardarlo al volver.
    </p>
  );
}
