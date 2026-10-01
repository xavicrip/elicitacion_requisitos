import type { DiagramSummary } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { projectKeys, projectsApi } from '../projects/api';
import { ProjectNotFound } from '../projects/ProjectNotFound';
import { diagramKeys, diagramsApi, useImageUrl } from './api';
import { UploadDialog } from './UploadDialog';

/** Diagramas del proyecto (US1). El Administrador sube diagramas mientras no esté cerrado. */
export function DiagramListPage() {
  const { projectId = '' } = useParams();
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const diagrams = useQuery({
    queryKey: diagramKeys.list(projectId),
    queryFn: () => diagramsApi.list(projectId),
  });

  if (project.error instanceof ApiError && project.error.status === 404) {
    return <ProjectNotFound />;
  }
  if (project.isLoading || diagrams.isLoading) return <p>Cargando…</p>;
  if (!project.data || !diagrams.data) {
    return <FormError>No se pudieron cargar los diagramas.</FormError>;
  }

  const isAdmin = project.data.myRole === 'admin';
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-600">
            <Link to={`/proyectos/${projectId}`} className="underline">
              {project.data.name}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Diagramas</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <Link to={`/proyectos/${projectId}/requisitos-huerfanos`} className="text-sm underline">
              Requisitos sin actividad
            </Link>
          )}
          {isAdmin && project.data.status !== 'closed' && <UploadDialog projectId={projectId} />}
        </div>
      </header>
      {diagrams.data.length === 0 ? (
        <p>Todavía no hay diagramas.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
          {diagrams.data.map((diagram) => (
            <DiagramCard
              key={diagram.id}
              projectId={projectId}
              diagram={diagram}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function DiagramCard({
  projectId,
  diagram,
  isAdmin,
}: {
  projectId: string;
  diagram: DiagramSummary;
  isAdmin: boolean;
}) {
  const thumb = useImageUrl(diagram.thumbUrl);
  return (
    <li>
      <Link
        to={`/proyectos/${projectId}/diagramas/${diagram.id}`}
        className="block space-y-2 rounded border p-3 hover:bg-gray-50"
      >
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-gray-100">
          {thumb && <img src={thumb} alt={diagram.name} className="max-h-full max-w-full" />}
        </div>
        <span className="block font-medium">{diagram.name}</span>
        {isAdmin && (
          <span className="text-sm text-gray-600">
            {diagram.draftVersionId ? 'Borrador' : 'Publicado'}
          </span>
        )}
      </Link>
    </li>
  );
}
