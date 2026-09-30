import type {
  Activity as ActivityDto,
  DiagramVersion as DiagramVersionDto,
} from '@reqcanvas/shared';
import type { Activity } from './models/activity.js';
import type { DiagramVersion } from './models/version.js';

/** Rutas relativas al origen de `web`, que las pasa a `api` por su proxy `/api` (plan ajuste 1). */
export const imageUrl = (versionId: string, variant: 'display' | 'thumb') =>
  `/api/diagram-versions/${versionId}/image/${variant}`;

export function toVersionDto(version: DiagramVersion): DiagramVersionDto {
  const id = version._id.toHexString();
  return {
    id,
    diagramId: version.diagramId.toHexString(),
    number: version.number,
    status: version.status,
    image: {
      displayUrl: imageUrl(id, 'display'),
      thumbUrl: imageUrl(id, 'thumb'),
      width: version.image.width,
      height: version.image.height,
    },
    publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
  };
}

export function toActivityDto(activity: Activity): ActivityDto {
  return {
    id: activity._id.toHexString(),
    key: activity.key,
    rev: activity.rev,
    source: activity.source,
    label: activity.label,
    type: activity.type,
    bbox: { x: activity.bbox.x, y: activity.bbox.y, w: activity.bbox.w, h: activity.bbox.h },
    next: [...activity.next],
  };
}
