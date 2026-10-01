import type { Activity, Project, VersionStatus, VersionWithActivities } from '@reqcanvas/shared';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { FormError } from '../../../components/form';
import { supportsWebGL2 } from '../../../lib/config';
import { useMediaQuery } from '../../../lib/media';
import { projectKeys, projectsApi } from '../../projects/api';
import { diagramKeys, diagramsApi, useImageUrl } from '../api';
import { EditorPanel } from '../editor/EditorPanel';
import { AutosaveProvider } from '../editor/useAutosave';
import { NewVersionDialog } from '../NewVersionDialog';
import { PublishButton } from '../PublishButton';
import { TYPE_LABEL } from '../labels';
import { A11yActivityList } from './A11yActivityList';
import type { HotspotExtensions } from './ActivityHotspots';
import { Minimap } from './Minimap';
import { useWorkspaceStore } from './store';
import { useWorkspaceKeyboard } from './useWorkspaceKeyboard';

// three.js solo se descarga al abrir un diagrama.
const loadCanvas = () => import('./DiagramCanvas');
const DiagramCanvas = lazy(loadCanvas);

const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

/**
 * Espacio de trabajo de un diagrama (contracts/canvas-ui.md). El Administrador trabaja sobre el
 * borrador si lo hay; los Participantes, sobre la versión publicada.
 */
/** Lo que un panel lateral necesita saber de la página. */
export type SidePanelContext = {
  project: Project;
  diagramId: string;
  version: VersionWithActivities;
};

export type WorkspacePageProps = HotspotExtensions & {
  /** Panel lateral en modo vista para la actividad seleccionada (la 004 monta los requisitos). */
  sidePanel?: (selectedKey: string | null, context: SidePanelContext) => ReactNode;
  /**
   * El Administrador abre el borrador (modo edit). Con `onPreferPublishedChange`, puede cambiar a
   * la versión publicada, p. ej. para ver sus requisitos (plan de la 004, ajuste 8).
   */
  preferPublished?: boolean;
  onPreferPublishedChange?: (preferPublished: boolean) => void;
};

export function WorkspacePage({
  sidePanel,
  preferPublished = false,
  onPreferPublishedChange,
  ...hotspots
}: WorkspacePageProps = {}) {
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
  const hasBoth = Boolean(summary?.draftVersionId && summary.publishedVersionId);
  const versionId = summary
    ? preferPublished && summary.publishedVersionId
      ? summary.publishedVersionId
      : (summary.draftVersionId ?? summary.publishedVersionId)
    : undefined;
  const version = useQuery({
    queryKey: diagramKeys.version(versionId ?? ''),
    queryFn: () => diagramsApi.version(versionId!),
    enabled: Boolean(versionId),
  });
  // Pide el chunk del canvas al abrir la página, en paralelo con la API y la imagen, y no
  // después de recibir la imagen (en staging ahorra una ida y vuelta de ~0,4 s).
  useEffect(() => {
    if (supportsWebGL2()) void loadCanvas();
  }, []);
  const open = useWorkspaceStore((state) => state.open);
  // Modo edit (contracts/canvas-ui.md): Administrador, versión en borrador, proyecto no
  // cerrado y pantalla de al menos 768 px (FR-010: en móvil, solo lectura).
  const wide = useMediaQuery('(min-width: 768px)');
  const editing =
    project.data?.myRole === 'admin' &&
    project.data.status !== 'closed' &&
    version.data?.status === 'draft' &&
    wide;
  useEffect(() => {
    if (versionId) open(versionId, editing ? 'edit' : 'view');
  }, [versionId, editing, open]);
  useWorkspaceKeyboard();
  const selectedKey = useWorkspaceStore((state) => state.selectedActivityKey);

  if (project.isLoading || diagrams.isLoading || version.isLoading) return <p>Cargando…</p>;
  if (diagrams.data && !versionId) return <p>Diagrama no encontrado</p>;
  if (!project.data || !summary || !version.data) {
    return <FormError>No se pudo cargar el diagrama.</FormError>;
  }

  const isAdmin = project.data.myRole === 'admin';
  const writable = isAdmin && project.data.status !== 'closed';
  return (
    <AutosaveProvider key={version.data.id} versionId={version.data.id}>
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600">
              <Link to={`/proyectos/${projectId}/diagramas`} className="underline">
                Diagramas
              </Link>
            </p>
            <h1 className="text-2xl font-semibold">{summary.name}</h1>
            <p className="text-sm text-gray-600">
              Versión {version.data.number} · {STATUS_LABEL[version.data.status]}
            </p>
          </div>
          {isAdmin && hasBoth && onPreferPublishedChange && (
            <button
              type="button"
              onClick={() => onPreferPublishedChange(!preferPublished)}
              className="rounded border px-4 py-2"
            >
              {preferPublished ? 'Editar el borrador' : 'Ver la versión publicada'}
            </button>
          )}
          {writable && version.data.status === 'draft' && (
            <PublishButton projectId={projectId} version={version.data} />
          )}
          {writable && !summary.draftVersionId && (
            <NewVersionDialog projectId={projectId} diagramId={diagramId} />
          )}
        </header>
        <div className={editing || sidePanel ? 'grid gap-4 md:grid-cols-[1fr_20rem]' : 'space-y-3'}>
          <Workspace
            displayUrl={version.data.image.displayUrl}
            thumbUrl={version.data.image.thumbUrl}
            image={{ width: version.data.image.width, height: version.data.image.height }}
            versionId={version.data.id}
            activities={version.data.activities}
            editing={editing}
            hotspots={hotspots}
          />
          {editing && <EditorPanel versionId={version.data.id} />}
          {!editing &&
            sidePanel?.(selectedKey, { project: project.data, diagramId, version: version.data })}
          {!editing && !sidePanel && (
            <SelectedActivity activities={version.data.activities} selectedKey={selectedKey} />
          )}
        </div>
      </section>
    </AutosaveProvider>
  );
}

/** Actividad seleccionada en modo vista (sin `sidePanel`). */
function SelectedActivity({
  activities,
  selectedKey,
}: {
  activities: Activity[];
  selectedKey: string | null;
}) {
  const selected = activities.find((activity) => activity.key === selectedKey);
  if (!selected) {
    return (
      <p className="text-sm text-gray-600">
        Selecciona una actividad en el diagrama o tabula hasta ella. Zoom con la rueda o con +/-, 0
        para ajustar.
      </p>
    );
  }
  return (
    <p className="text-sm">
      <strong>{selected.label}</strong> · {TYPE_LABEL[selected.type]}
    </p>
  );
}

function Workspace({
  displayUrl,
  thumbUrl,
  image,
  versionId,
  activities,
  editing,
  hotspots,
}: {
  displayUrl: string;
  thumbUrl: string;
  image: { width: number; height: number };
  versionId: string;
  activities: Activity[];
  editing: boolean;
  hotspots: HotspotExtensions;
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
      {/* El canvas se monta sin esperar a la imagen: el contexto WebGL se crea mientras llega. */}
      <Suspense fallback={null}>
        <DiagramCanvas
          imageUrl={imageUrl}
          image={image}
          versionId={versionId}
          editing={editing}
          hotspots={hotspots}
        />
      </Suspense>
      {!editing && <A11yActivityList activities={activities} image={image} />}
      <Minimap thumbUrl={thumbUrl} image={image} />
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
