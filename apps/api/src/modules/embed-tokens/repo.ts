import { db } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';
import type { EmbedTokenRow } from './dto';

const EMBED_TOKEN_SELECT = {
  id: true,
  workspaceId: true,
  token: true,
  label: true,
  allowedOrigin: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listEmbedTokens(scope: WorkspaceScope): Promise<EmbedTokenRow[]> {
  return db.embedToken.findMany({
    where: { workspaceId: scope.workspaceId },
    select: EMBED_TOKEN_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export function findEmbedToken(scope: WorkspaceScope, id: string): Promise<EmbedTokenRow | null> {
  return db.embedToken.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    select: EMBED_TOKEN_SELECT,
  });
}

export function createEmbedToken(
  scope: WorkspaceScope,
  data: { token: string; label: string; allowedOrigin: string },
): Promise<EmbedTokenRow> {
  return db.embedToken.create({
    data: {
      workspaceId: scope.workspaceId,
      token: data.token,
      label: data.label,
      allowedOrigin: data.allowedOrigin,
    },
    select: EMBED_TOKEN_SELECT,
  });
}

/** Soft-revoke: sets isActive = false so the row remains auditable. */
export function revokeEmbedToken(scope: WorkspaceScope, id: string): Promise<EmbedTokenRow> {
  return db.embedToken.update({
    where: { id, workspaceId: scope.workspaceId },
    data: { isActive: false },
    select: EMBED_TOKEN_SELECT,
  });
}
