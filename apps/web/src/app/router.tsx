import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { requireSession } from '../features/auth/session';
import { ProjectSettingsPage } from '../features/projects/ProjectSettingsPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { FlagGate } from '../lib/flags';
import '../lib/zod';
import { HomePage } from './HomePage';
import { Layout } from './Layout';
import { NotFoundPage } from './NotFoundPage';

/** Rutas de la feature 002: con el flag `accounts` desactivado, no existen (constitución IV). */
const accounts = (element: ReactNode) => (
  <FlagGate flag="accounts" fallback={<NotFoundPage />}>
    {element}
  </FlagGate>
);

/** Rutas de la app (React Router 7, modo librería; research R10). */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'entrar', element: accounts(<LoginPage />) },
      { path: 'registro', element: accounts(<RegisterPage />) },
      { path: 'proyectos', loader: requireSession, element: accounts(<ProjectsPage />) },
      {
        path: 'proyectos/:projectId',
        loader: requireSession,
        element: accounts(<ProjectSettingsPage />),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** Proveedores comunes: datos del servidor con TanStack Query. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function AppRouter() {
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
