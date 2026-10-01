import type { Detail as DetailDto, DetailPermissions, UserRef } from '@reqcanvas/shared';
import type { Detail } from './models/detail.js';

export function toDetailDto(
  detail: Detail,
  extra: { author: UserRef; votedByMe: boolean; permissions: DetailPermissions },
): DetailDto {
  return {
    id: detail._id.toHexString(),
    diagramId: detail.diagramId.toHexString(),
    activityKey: detail.activityKey,
    given: detail.given,
    when: detail.when,
    then: detail.then,
    type: detail.type,
    priority: detail.priority ?? null,
    authorRole: detail.authorRole ?? null,
    tags: [...detail.tags],
    status: detail.status,
    duplicateOf: detail.duplicateOf ? detail.duplicateOf.toHexString() : null,
    discardReason: detail.discardReason ?? null,
    voteCount: detail.voteCount,
    votedByMe: extra.votedByMe,
    commentCount: detail.commentCount,
    author: extra.author,
    rev: detail.rev,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    permissions: extra.permissions,
  };
}
