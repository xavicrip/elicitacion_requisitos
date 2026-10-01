import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { DiagramListPage } from '../features/diagrams/DiagramListPage';
import { OrphansPage } from '../features/details/OrphansPage';
import { AcceptInvitationPage } from '../features/invitations/AcceptInvitationPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { requireSession } from '../features/auth/session';
import { RealtimeWorkspace } from '../features/realtime/RealtimeWorkspace';
import { ProjectSettingsPage } from '../features/projects/ProjectSettingsPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { flagsQuery } from '../lib/flags';
import '../lib/zod';
import { HomePage } from './HomePage';
import { Layout } from './Layout';
import { NotFoundPage } from './NotFoundPage';

/** Rutas de la app (React Router 7, modo librería; research R10). */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'entrar', element: <LoginPage /> },
      { path: 'registro', element: <RegisterPage /> },
      { path: 'proyectos', loader: requireSession, element: <ProjectsPage /> },
      {
        path: 'proyectos/:projectId',
        loader: requireSession,
        element: <ProjectSettingsPage />,
      },
      {
        path: 'proyectos/:projectId/diagramas',
        loader: requireSession,
        element: <DiagramListPage />,
      },
      {
        path: 'proyectos/:projectId/diagramas/:diagramId',
        loader: requireSession,
        element: <RealtimeWorkspace />,
      },
      {
        path: 'proyectos/:projectId/requisitos-huerfanos',
        loader: requireSession,
        element: <OrphansPage />,
      },
      { path: 'invitacion/:token', element: <AcceptInvitationPage /> },
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
