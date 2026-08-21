import type { CannedResponseListQuery } from '@gigachad/shared';

import { db } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';
import type { CannedResponseRow } from './dto';

const SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  content: true,
  shortcut: true,
  tags: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listCannedResponses(scope: WorkspaceScope, query: CannedResponseListQuery) {
  return db.cannedResponse.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(query.tag
        ? { tags: { array_contains: [query.tag] } }
        : {}),
      // Full text search: name contains OR shortcut starts with (case-insensitive)
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { shortcut: { contains: query.search, mode: 'insensitive' } },
              { content: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: SELECT,
    orderBy: [{ name: 'asc' }],
  }) as Promise<CannedResponseRow[]>;
}

export function findCannedResponse(scope: WorkspaceScope, id: string) {
  return db.cannedResponse.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    select: SELECT,
  }) as Promise<CannedResponseRow | null>;
}

export function findCannedResponseByShortcut(scope: WorkspaceScope, shortcut: string) {
  return db.cannedResponse.findFirst({
    where: { workspaceId: scope.workspaceId, shortcut },
    select: { id: true },
  });
}

export function createCannedResponse(
  scope: WorkspaceScope,
  data: { name: string; content: string; shortcut?: string; tags: string[]; createdBy: string },
) {
  return db.cannedResponse.create({
    data: { workspaceId: scope.workspaceId, ...data },
    select: SELECT,
  }) as Promise<CannedResponseRow>;
}

export function updateCannedResponse(
  scope: WorkspaceScope,
  id: string,
  data: { name?: string; content?: string; shortcut?: string | null; tags?: string[] },
) {
  return db.cannedResponse.update({
    where: { id, workspaceId: scope.workspaceId },
    data,
    select: SELECT,
  }) as Promise<CannedResponseRow>;
}

export function deleteCannedResponse(scope: WorkspaceScope, id: string) {
  return db.cannedResponse.delete({
    where: { id, workspaceId: scope.workspaceId },
  });
}
