import type { Invitation, Member, Project, Role } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';
import { membersApi, projectKeys } from './api';
import { ROLE_LABEL } from './labels';

const INVITATION_LABEL: Record<Invitation['status'], string> = {
  active: 'Activa',
  expired: 'Caducada',
  revoked: 'Revocada',
};

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'No se pudo completar la acción.';

/**
 * Miembros del proyecto (US3). Todos los miembros ven la lista y pueden abandonar el proyecto;
 * el Administrador cambia roles, retira miembros y gestiona los enlaces de invitación.
 */
export function MembersPanel({ project }: { project: Project }) {
  const titleId = useId();
  const me = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const isAdmin = project.myRole === 'admin';

  const { data: members } = useQuery({
    queryKey: projectKeys.members(project.id),
    queryFn: () => membersApi.list(project.id),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.members(project.id) });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      membersApi.changeRole(project.id, userId, role),
    onMutate: () => setError(''),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(project.id) });
    },
    onError: async (err) => {
      setError(messageOf(err));
      await refresh(); // Devuelve el selector al rol real.
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => membersApi.remove(project.id, userId),
    onMutate: () => setError(''),
    onSuccess: async (_result, userId) => {
      if (userId === me?.id) {
        // Quien abandona el proyecto deja de tener acceso a esta página.
        queryClient.removeQueries({ queryKey: projectKeys.detail(project.id) });
        await queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
        navigate('/proyectos');
        return;
      }
      await refresh();
    },
    onError: (err) => setError(messageOf(err)),
  });

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded border p-4">
      <h2 id={titleId} className="text-lg font-semibold">
        Miembros
      </h2>
      <FormError>{error}</FormError>
      <ul className="divide-y">
        {members?.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isAdmin={isAdmin}
            isMe={member.userId === me?.id}
            onRoleChange={(role) => changeRole.mutate({ userId: member.userId, role })}
            onRemove={() => remove.mutate(member.userId)}
          />
        ))}
      </ul>
      {isAdmin && <InvitationsSection projectId={project.id} />}
    </section>
  );
}

function MemberRow({
  member,
  isAdmin,
  isMe,
  onRoleChange,
  onRemove,
}: {
  member: Member;
  isAdmin: boolean;
  isMe: boolean;
  onRoleChange: (role: Role) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span>
        <span className="font-medium">{member.name}</span>{' '}
        <span className="text-sm text-gray-600">{member.email}</span>
      </span>
      <span className="flex items-center gap-3 text-sm">
        {isAdmin ? (
          <select
            aria-label={`Rol de ${member.name}`}
            value={member.role}
            onChange={(event) => onRoleChange(event.target.value as Role)}
            className="rounded border px-2 py-1"
          >
            <option value="admin">{ROLE_LABEL.admin}</option>
            <option value="participant">{ROLE_LABEL.participant}</option>
          </select>
        ) : (
          <span>{ROLE_LABEL[member.role]}</span>
        )}
        {isMe ? (
          <button type="button" onClick={onRemove} className="underline">
            Abandonar proyecto
          </button>
        ) : (
          isAdmin && (
            <button type="button" onClick={onRemove} className="text-red-700 underline">
              Retirar a {member.name}
            </button>
          )
        )}
      </span>
    </li>
  );
}

function InvitationsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const linkId = useId();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const { data: invitations } = useQuery({
    queryKey: projectKeys.invitations(projectId),
    queryFn: () => membersApi.invitations(projectId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: projectKeys.invitations(projectId) });

  const invite = useMutation({
    mutationFn: () => membersApi.invite(projectId),
    onSuccess: async (created) => {
      setError('');
      setCopied(false);
      setUrl(created.url);
      await refresh();
    },
    onError: (err) => setError(messageOf(err)),
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) => membersApi.revoke(projectId, invitationId),
    onSuccess: refresh,
    onError: (err) => setError(messageOf(err)),
  });

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="font-semibold">Invitaciones</h3>
      <p className="text-sm text-gray-600">
        El enlace sirve para varias personas durante 7 días, o hasta que lo revoques.
      </p>
      <FormError>{error}</FormError>
      <button
        type="button"
        onClick={() => invite.mutate()}
        disabled={invite.isPending}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Generar enlace
      </button>
      {url && (
        <div className="flex gap-2">
          <label htmlFor={linkId} className="sr-only">
            Enlace de invitación
          </label>
          <input
            id={linkId}
            readOnly
            value={url}
            onFocus={(event) => event.target.select()}
            className="flex-1 rounded border px-3 py-2 text-sm"
          />
          <button type="button" onClick={copy} className="rounded border px-3 py-2 text-sm">
            Copiar enlace
          </button>
        </div>
      )}
      {copied && (
        <p role="status" className="text-sm text-green-800">
          Enlace copiado
        </p>
      )}
      <ul className="divide-y text-sm">
        {invitations?.map((invitation) => (
          <li key={invitation.id} className="flex items-center justify-between py-2">
            <span>
              {INVITATION_LABEL[invitation.status]} · caduca el{' '}
              {new Date(invitation.expiresAt).toLocaleDateString('es')} · {invitation.uses} usos
            </span>
            {invitation.status === 'active' && (
              <button
                type="button"
                onClick={() => revoke.mutate(invitation.id)}
                className="text-red-700 underline"
              >
                Revocar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
