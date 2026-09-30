import type { VersionStatus } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { FormError } from '../../../components/form';
import { supportsWebGL2 } from '../../../lib/config';
import { projectKeys, projectsApi } from '../../projects/api';
import { diagramKeys, diagramsApi, useImageUrl } from '../api';
import { useWorkspaceStore } from './store';

// three.js solo se descarga al abrir un diagrama.
const DiagramCanvas = lazy(() => import('./DiagramCanvas'));

const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

/**
 * Espacio de trabajo de un diagrama (contracts/canvas-ui.md). El Administrador trabaja sobre el
 * borrador si lo hay; los Participantes, sobre la versión publicada.
 */
export function WorkspacePage() {
  const { projectId = '', diagramId = '' } = useParams();
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  });
  const diagrams = useQuery({
    queryKey: diagramKeys.list(projectId),
    queryFn: () => diagramsApi.list(projectId),
  });
  const summary = diagrams.data?.find((diagram) => diagram.id === diagramId);
  const versionId = summary ? (summary.draftVersionId ?? summary.publishedVersionId) : undefined;
  const version = useQuery({
    queryKey: diagramKeys.version(versionId ?? ''),
    queryFn: () => diagramsApi.version(versionId!),
    enabled: Boolean(versionId),
  });
  const open = useWorkspaceStore((state) => state.open);
  useEffect(() => {
    if (versionId) open(versionId, 'view');
  }, [versionId, open]);

  if (project.isLoading || diagrams.isLoading || version.isLoading) return <p>Cargando…</p>;
  if (diagrams.data && !versionId) return <p>Diagrama no encontrado</p>;
  if (!project.data || !summary || !version.data) {
    return <FormError>No se pudo cargar el diagrama.</FormError>;
  }

  return (
    <section className="space-y-4">
      <header>
        <p className="text-sm text-gray-600">
          <Link to={`/proyectos/${projectId}/diagramas`} className="underline">
            Diagramas
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{summary.name}</h1>
        <p className="text-sm text-gray-600">
          Versión {version.data.number} · {STATUS_LABEL[version.data.status]}
        </p>
      </header>
      <Workspace
        displayUrl={version.data.image.displayUrl}
        image={{ width: version.data.image.width, height: version.data.image.height }}
      />
    </section>
  );
}

function Workspace({
  displayUrl,
  image,
}: {
  displayUrl: string;
  image: { width: number; height: number };
}) {
  const imageUrl = useImageUrl(displayUrl);
  const imageStatus = useWorkspaceStore((state) => state.imageStatus);

  if (!supportsWebGL2()) {
    return (
      <FormError>
        Tu navegador no admite WebGL 2, necesario para mostrar el diagrama. Actualízalo o prueba con
        otro navegador.
      </FormError>
    );
  }
  return (
    <div className="relative h-[70vh] overflow-hidden rounded border">
      {imageUrl && (
        <Suspense fallback={null}>
          <DiagramCanvas imageUrl={imageUrl} image={image} />
        </Suspense>
      )}
      {imageStatus === 'loading' && (
        <p className="absolute inset-0 flex items-center justify-center">Cargando imagen…</p>
      )}
      {imageStatus === 'error' && (
        <div className="absolute inset-x-4 top-4">
          <FormError>No se pudo cargar la imagen del diagrama.</FormError>
        </div>
      )}
    </div>
  );
}
