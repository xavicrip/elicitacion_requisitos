import { useEffect } from 'react';
import { Link, redirect, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { apiFetch, refreshSession } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';

/**
 * Loader de las rutas protegidas: sin access token en memoria intenta recuperar la sesión con
 * la cookie `rt` (recarga de la página); si no puede, lleva a /entrar recordando la página.
 */
export async function requireSession({ request }: LoaderFunctionArgs) {
  if (useAuthStore.getState().accessToken) return null;
  if (await refreshSession()) return null;
  const { pathname, search } = new URL(request.url);
  throw redirect(`/entrar?redirect=${encodeURIComponent(pathname + search)}`);
}

/** En las páginas públicas, recupera la sesión al cargar para mostrarla en la cabecera. */
export function SessionRestorer() {
  useEffect(() => {
    if (!useAuthStore.getState().accessToken) void refreshSession();
  }, []);
  return null;
}

/** Cabecera: usuario y "Cerrar sesión", o enlaces de acceso. */
export function SessionMenu() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();

  const logout = async () => {
    // Aunque la API falle, la sesión local se cierra: la cookie caduca sola.
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    useAuthStore.getState().clear();
    navigate('/entrar');
  };

  if (!user) {
    return (
      <nav className="flex gap-4 text-sm">
        <Link to="/entrar">Iniciar sesión</Link>
        <Link to="/registro" className="font-medium">
          Crear cuenta
        </Link>
      </nav>
    );
  }
  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link to="/proyectos">Mis proyectos</Link>
      <span className="text-gray-600">{user.name}</span>
      <button type="button" onClick={logout} className="underline">
        Cerrar sesión
      </button>
    </nav>
  );
}
