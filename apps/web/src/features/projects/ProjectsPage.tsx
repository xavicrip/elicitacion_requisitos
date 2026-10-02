import { zodResolver } from '@hookform/resolvers/zod';
import { ProjectInputSchema, type ProjectInput } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { applyApiError, Field, FormError } from '../../components/form';
import { projectKeys, projectsApi } from './api';
import { ROLE_LABEL, STATUS_LABEL } from './labels';

/** "Mis proyectos" (FR-012): proyectos del usuario con su estado y su rol, y la creación. */
export function ProjectsPage() {
  // Aviso que llega con la navegación, p. ej. al perder el acceso a un proyecto (005, FR-008).
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: projectKeys.list,
    queryFn: projectsApi.list,
  });

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Mis proyectos</h1>
      {notice && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2">
          {notice}
        </p>
      )}
      {isLoading && <p>Cargando…</p>}
      {error && <FormError>No se pudieron cargar tus proyectos.</FormError>}
      {projects?.length === 0 && <p className="text-gray-600">Todavía no tienes proyectos.</p>}
      {projects && projects.length > 0 && (
        <ul className="divide-y rounded border">
          {projects.map((project) => (
            <li key={project.id} className="flex items-center justify-between gap-4 p-4">
              <Link to={`/proyectos/${project.id}`} className="font-medium">
                {project.name}
              </Link>
              <span className="flex gap-3 text-sm text-gray-600">
                <span>{STATUS_LABEL[project.status]}</span>
                <span>{ROLE_LABEL[project.myRole]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <CreateProjectForm />
    </section>
  );
}

function CreateProjectForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState('');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({ resolver: zodResolver(ProjectInputSchema) });

  const create = useMutation({ mutationFn: projectsApi.create });

  const onSubmit = handleSubmit(async (input) => {
    setFormError('');
    try {
      const project = await create.mutateAsync(input);
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      await queryClient.invalidateQueries({ queryKey: projectKeys.list });
      navigate(`/proyectos/${project.id}`);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-lg space-y-4 rounded border p-4">
      <h2 className="text-lg font-semibold">Nuevo proyecto</h2>
      <FormError>{formError}</FormError>
      <Field label="Nombre del proyecto" id="new-name" error={errors.name} {...register('name')} />
      <Field
        label="Descripción"
        id="new-description"
        error={errors.description}
        {...register('description')}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Crear proyecto
      </button>
    </form>
  );
}
