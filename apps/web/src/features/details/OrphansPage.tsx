import type { Detail } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { diagramKeys, diagramsApi } from '../diagrams/api';
import { projectKeys, projectsApi } from '../projects/api';
import { ProjectNotFound } from '../projects/ProjectNotFound';
import { detailKeys, detailsApi } from './api';

/** Reasignación de un huérfano: diagrama y actividad de su versión publicada. */
function Reassign({ projectId, detail }: { projectId: string; detail: Detail }) {
  const queryClient = useQueryClient();
  const diagramFieldId = useId();
  const activityFieldId = useId();
  const [diagramId, setDiagramId] = useState('');
  const [activityKey, setActivityKey] = useState('');
  const [error, setError] = useState('');
  const diagrams = useQuery({
    queryKey: diagramKeys.list(projectId),
    queryFn: () => diagramsApi.list(projectId),
  });
  const published = diagrams.data?.filter((diagram) => diagram.publishedVersionId) ?? [];
  const versionId = published.find((diagram) => diagram.id === diagramId)?.publishedVersionId;
  const version = useQuery({
    queryKey: diagramKeys.version(versionId ?? ''),
    queryFn: () => diagramsApi.version(versionId!),
    enabled: Boolean(versionId),
  });
  const reassign = useMutation({
    mutationFn: () => detailsApi.reassign(detail.id, { diagramId, activityKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: detailKeys.all }),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo reasignar el requisito.'),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (activityKey) reassign.mutate();
      }}
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <div className="space-y-1">
        <label htmlFor={diagramFieldId} className="block text-xs font-medium">
          Diagrama
        </label>
        <select
          id={diagramFieldId}
          value={diagramId}
          onChange={(event) => {
            setDiagramId(event.target.value);
            setActivityKey('');
          }}
          className="w-full rounded border px-2 py-1"
        >
          <option value="">Elige un diagrama</option>
          {published.map((diagram) => (
            <option key={diagram.id} value={diagram.id}>
              {diagram.name}
            </option>
          ))}
        </select>
      </div>
      {version.data && (
        <div className="space-y-1">
          <label htmlFor={activityFieldId} className="block text-xs font-medium">
            Actividad
          </label>
          <select
            id={activityFieldId}
            value={activityKey}
            onChange={(event) => setActivityKey(event.target.value)}
            className="w-full rounded border px-2 py-1"
          >
            <option value="">Elige una actividad</option>
            {version.data.activities.map((activity) => (
              <option key={activity.key} value={activity.key}>
                {activity.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="submit"
        disabled={!activityKey || reassign.isPending}
        className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50"
      >
        Reasignar
      </button>
      <FormError>{error}</FormError>
    </form>
  );
}

/**
 * Requisitos huérfanos del proyecto (edge case de la spec): su actividad ya no está en la versión
 * publicada del diagrama. Solo el Administrador los ve y los reasigna.
 */
export function OrphansPage() {
  const { projectId = '' } = useParams();
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const isAdmin = project.data?.myRole === 'admin';
  const orphans = useQuery({
    queryKey: detailKeys.orphans(projectId),
    queryFn: () => detailsApi.orphans(projectId),
    enabled: isAdmin,
  });

  if (project.error instanceof ApiError && project.error.status === 404) return <ProjectNotFound />;
  if (project.isLoading || orphans.isLoading) return <p>Cargando…</p>;
  if (!isAdmin) return <ProjectNotFound />;
  const writable = project.data?.status === 'open';

  return (
    <section className="space-y-4">
      <header>
        <p className="text-sm text-gray-600">
          <Link to={`/proyectos/${projectId}/diagramas`} className="underline">
            Diagramas
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Requisitos sin actividad</h1>
        <p className="text-sm text-gray-600">
          Su actividad ya no está en la versión publicada del diagrama. Reasígnalos a otra.
        </p>
      </header>
      {orphans.data?.length === 0 && <p>No hay requisitos sin actividad.</p>}
      <div className="space-y-3">
        {orphans.data?.map((detail) => (
          <article key={detail.id} className="space-y-2 rounded border p-3 text-sm">
            <p>
              <strong>Dado</strong> {detail.given} <strong>Cuando</strong> {detail.when}{' '}
              <strong>Entonces</strong> {detail.then}
            </p>
            <p className="text-gray-600">{detail.author.name}</p>
            {writable ? (
              <Reassign projectId={projectId} detail={detail} />
            ) : (
              <p className="text-gray-600">El proyecto no está abierto: no se puede reasignar.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
