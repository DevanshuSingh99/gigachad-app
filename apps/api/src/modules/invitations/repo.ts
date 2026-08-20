import { db, unscoped, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
} as const;

export function listPending(scope: WorkspaceScope) {
  return db.invitation.findMany({
    where: { workspaceId: scope.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: INVITATION_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export function findPendingForEmail(scope: WorkspaceScope, email: string) {
  return db.invitation.findFirst({
    where: { workspaceId: scope.workspaceId, email, acceptedAt: null },
    select: { id: true },
  });
}

export function createInvitation(data: {
  workspaceId: string;
  email: string;
  role: 'ADMIN' | 'AGENT';
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
}) {
  return db.invitation.create({ data, select: INVITATION_SELECT });
}

/** Replaces a superseded invitation's token so only the newest link works. */
export function replaceInvitation(
  scope: WorkspaceScope,
  id: string,
  data: { role: 'ADMIN' | 'AGENT'; tokenHash: string; expiresAt: Date; invitedBy: string },
) {
  return db.invitation.update({
    where: { id, workspaceId: scope.workspaceId },
    data,
    select: INVITATION_SELECT,
  });
}

/**
 * Token lookup, before any workspace is known — the token IS the claim to a
 * workspace, so this is necessarily cross-tenant.
 */
export function findByTokenHash(client: Tx, tokenHash: string) {
  return unscoped('accept invitation: resolve it by token hash before the workspace is known', () =>
    client.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        workspaceId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        workspace: { select: { name: true, slug: true } },
      },
    }),
  );
}

export function markAccepted(client: Tx, scope: WorkspaceScope, id: string) {
  return client.invitation.update({
    where: { id, workspaceId: scope.workspaceId },
    // Guarded by acceptedAt: null in the caller's read plus the workspace row lock,
    // so a double submit cannot consume the token twice.
    data: { acceptedAt: new Date() },
    select: { id: true },
  });
}
