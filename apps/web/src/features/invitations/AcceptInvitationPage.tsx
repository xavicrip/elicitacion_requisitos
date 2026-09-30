import type { InvitationPreview, ProjectSummary } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FormError } from '../../components/form';
import { ApiError, apiFetch, refreshSession } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';
import { projectKeys } from '../projects/api';

/**
 * Enlace de invitación (US3 escenarios 2 y 3). Con sesión, un clic une al proyecto. Sin sesión,
 * se registra o entra y vuelve aquí con `?unirse=1`, que completa la unión automáticamente.
 */
export function AcceptInvitationPage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [sessionChecked, setSessionChecked] = useState(
    () => useAuthStore.getState().accessToken !== null,
  );
  const autoJoinTried = useRef(false);

  // Página pública: recupera la sesión (cookie) antes de decidir qué ofrecer.
  useEffect(() => {
    if (!sessionChecked) void refreshSession().finally(() => setSessionChecked(true));
  }, [sessionChecked]);

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch<InvitationPreview>(`/invitations/${token}`),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => apiFetch<ProjectSummary>(`/invitations/${token}/accept`, { method: 'POST' }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
      navigate(`/proyectos/${project.id}`);
    },
  });

  const autoJoin = params.get('unirse') === '1';
  useEffect(() => {
    if (autoJoin && user && preview.data && !autoJoinTried.current) {
      autoJoinTried.current = true;
      join.mutate();
    }
  }, [autoJoin, user, preview.data, join]);

  if (preview.error instanceof ApiError && preview.error.status === 410) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Esta invitación ya no es válida</h1>
        <p>Pide a quien administra el proyecto un enlace nuevo.</p>
        <Link to="/" className="text-blue-700 underline">
          Volver al inicio
        </Link>
      </section>
    );
  }
  if (preview.isLoading || !sessionChecked) return <p>Cargando…</p>;
  if (!preview.data) return <FormError>No se pudo cargar la invitación.</FormError>;

  const back = encodeURIComponent(`/invitacion/${token}?unirse=1`);
  return (
    <section className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Invitación a un proyecto</h1>
      <p>
        Te han invitado a unirte a <strong>{preview.data.projectName}</strong> como Participante.
      </p>
      <FormError>{join.error instanceof ApiError ? join.error.message : ''}</FormError>
      {user ? (
        <button
          type="button"
          onClick={() => join.mutate()}
          disabled={join.isPending}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          Unirme al proyecto
        </button>
      ) : (
        <div className="flex gap-4">
          <Link to={`/registro?redirect=${back}`} className="font-medium">
            Crear cuenta
          </Link>
          <Link to={`/entrar?redirect=${back}`}>Iniciar sesión</Link>
        </div>
      )}
    </section>
  );
}
