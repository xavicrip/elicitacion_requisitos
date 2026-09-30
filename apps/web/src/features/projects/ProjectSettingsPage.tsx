import { zodResolver } from '@hookform/resolvers/zod';
import { ProjectInputSchema, type Project, type ProjectInput } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import { applyApiError, Field, FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { projectKeys, projectsApi } from './api';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { ROLE_LABEL, STATUS_ACTION, STATUS_LABEL } from './labels';

/** Página de un proyecto: datos, estado y, para el Administrador, edición y borrado. */
export function ProjectSettingsPage() {
  const { projectId = '' } = useParams();
  const {
    data: project,
    error,
    isLoading,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
  });

  if (isLoading) return <p>Cargando…</p>;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Proyecto no encontrado</h1>
        <p>El proyecto no existe o no tienes acceso a él.</p>
      </section>
    );
  }
  if (!project) return <FormError>No se pudo cargar el proyecto.</FormError>;

  const isAdmin = project.myRole === 'admin';
  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="flex gap-3 text-sm text-gray-600">
          <span>{STATUS_LABEL[project.status]}</span>
          <span>{ROLE_LABEL[project.myRole]}</span>
        </p>
        {!isAdmin && project.description && <p>{project.description}</p>}
      </header>
      {isAdmin && (
        <>
          <StatusActions project={project} />
          <EditProjectForm key={project.id} project={project} />
          <DeleteProjectDialog project={project} />
        </>
      )}
    </section>
  );
}

function StatusActions({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const { action, label } = STATUS_ACTION[project.status];
  const change = useMutation({
    mutationFn: () => projectsApi.changeStatus(project.id, action),
    onSuccess: async (updated) => {
      setError('');
      queryClient.setQueryData(projectKeys.detail(project.id), updated);
      await queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo cambiar.'),
  });
  return (
    <div className="space-y-2">
      <FormError>{error}</FormError>
      <button
        type="button"
        onClick={() => change.mutate()}
        disabled={change.isPending}
        className="rounded border px-4 py-2 font-medium disabled:opacity-60"
      >
        {label}
      </button>
    </div>
  );
}

function EditProjectForm({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({
    resolver: zodResolver(ProjectInputSchema),
    defaultValues: { name: project.name, description: project.description ?? '' },
  });

  const onSubmit = handleSubmit(async (input) => {
    setFormError('');
    setSaved(false);
    try {
      // apiFetch renueva la sesión y reintenta si ha caducado: el texto no se pierde.
      const updated = await projectsApi.update(project.id, input);
      queryClient.setQueryData(projectKeys.detail(project.id), updated);
      reset({ name: updated.name, description: updated.description ?? '' });
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-lg space-y-4 rounded border p-4">
      <h2 className="text-lg font-semibold">Datos del proyecto</h2>
      <FormError>{formError}</FormError>
      {saved && (
        <p role="status" className="text-sm text-green-800">
          Cambios guardados
        </p>
      )}
      <Field label="Nombre" id="edit-name" error={errors.name} {...register('name')} />
      <Field
        label="Descripción"
        id="edit-description"
        error={errors.description}
        {...register('description')}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Guardar cambios
      </button>
    </form>
  );
}
