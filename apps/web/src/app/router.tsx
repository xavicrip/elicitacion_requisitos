import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { DiagramListPage } from '../features/diagrams/DiagramListPage';
import { DetailsWorkspacePage } from '../features/details/DetailsWorkspacePage';
import { OrphansPage } from '../features/details/OrphansPage';
import { AcceptInvitationPage } from '../features/invitations/AcceptInvitationPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { requireSession } from '../features/auth/session';
import { ProjectSettingsPage } from '../features/projects/ProjectSettingsPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { FlagGate, flagsQuery } from '../lib/flags';
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

/** Rutas de la feature 003: detrás del flag `diagrams` (plan ajuste 4). */
const diagrams = (element: ReactNode) =>
  accounts(
    <FlagGate flag="diagrams" fallback={<NotFoundPage />}>
      {element}
    </FlagGate>,
  );

/** Rutas de la feature 004: además, detrás del flag `details` (plan de la 004, ajuste 2). */
const details = (element: ReactNode) =>
  diagrams(
    <FlagGate flag="details" fallback={<NotFoundPage />}>
      {element}
    </FlagGate>,
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
      {
        path: 'proyectos/:projectId/diagramas',
        loader: requireSession,
        element: diagrams(<DiagramListPage />),
      },
      {
        path: 'proyectos/:projectId/diagramas/:diagramId',
        loader: requireSession,
        element: diagrams(<DetailsWorkspacePage />),
      },
      {
        path: 'proyectos/:projectId/requisitos-huerfanos',
        loader: requireSession,
        element: details(<OrphansPage />),
      },
      { path: 'invitacion/:token', element: accounts(<AcceptInvitationPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** Proveedores comunes: datos del servidor con TanStack Query. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
    });
    // Los flags se piden al arrancar, en paralelo con el refresco de la sesión de los loaders, en
    // lugar de esperar a que se pinte la primera ruta (una petición menos en serie).
    void client.prefetchQuery(flagsQuery);
    return client;
  });
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
