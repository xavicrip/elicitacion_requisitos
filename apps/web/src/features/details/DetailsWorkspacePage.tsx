import { useState } from 'react';
import { WorkspacePage } from '../diagrams/workspace/WorkspacePage';
import { useFlags } from '../../lib/flags';
import { DetailsPanel } from './DetailsPanel';

/**
 * Espacio de trabajo de la 003 con los requisitos de la 004 (plan, ajuste 8): el panel lateral
 * de detalles y, para el Administrador, el cambio entre el borrador y la versión publicada.
 * Sin el flag `details`, es el espacio de trabajo de la 003 tal cual.
 */
export function DetailsWorkspacePage() {
  const { flags, isLoading } = useFlags();
  const [preferPublished, setPreferPublished] = useState(false);
  if (isLoading) return null;
  if (!flags.details) return <WorkspacePage />;
  return (
    <WorkspacePage
      preferPublished={preferPublished}
      onPreferPublishedChange={setPreferPublished}
      sidePanel={(activityKey, context) => <DetailsPanel activityKey={activityKey} {...context} />}
    />
  );
}
