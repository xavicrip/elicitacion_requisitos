import { Link, Outlet } from 'react-router';
import { SessionMenu, SessionRestorer } from '../features/auth/session';
import { getConfig } from '../lib/config';
import { FlagGate } from '../lib/flags';

/** Estructura común: cabecera, contenido de la ruta y versión desplegada. */
export function Layout() {
  const { version } = getConfig();
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 font-sans">
      <header className="flex items-center justify-between border-b py-4">
        <Link to="/" className="text-lg font-semibold">
          ReqCanvas
        </Link>
        <FlagGate flag="accounts">
          <SessionRestorer />
          <SessionMenu />
        </FlagGate>
      </header>
      <main className="flex-1 py-8">
        <Outlet />
      </main>
      <footer className="border-t py-4 text-sm text-gray-500">
        <small>v{version}</small>
      </footer>
    </div>
  );
}
