import { db, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

/**
 * Members repository. Every query is workspace-scoped, so the guard in src/db.ts
 * is satisfied without an escape hatch anywhere in this file.
 */

const MEMBER_SELECT = {
  id: true,
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
} as const;

export function listMembers(scope: WorkspaceScope) {
  return db.workspaceMember.findMany({
    where: { workspaceId: scope.workspaceId, status: 'ACTIVE' },
    select: MEMBER_SELECT,
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
}

export function findMember(client: Tx, scope: WorkspaceScope, memberId: string) {
  return client.workspaceMember.findFirst({
    where: { id: memberId, workspaceId: scope.workspaceId, status: 'ACTIVE' },
    select: MEMBER_SELECT,
  });
}

export function findMembershipForUser(client: Tx, scope: WorkspaceScope, userId: string) {
  return client.workspaceMember.findFirst({
    where: { workspaceId: scope.workspaceId, userId },
    select: { id: true, role: true, status: true },
  });
}

export function countActiveAdmins(client: Tx, scope: WorkspaceScope) {
  return client.workspaceMember.count({
    where: { workspaceId: scope.workspaceId, role: 'ADMIN', status: 'ACTIVE' },
  });
}

export function setMemberRole(
  client: Tx,
  scope: WorkspaceScope,
  memberId: string,
  role: 'ADMIN' | 'AGENT',
) {
  return client.workspaceMember.update({
    // The compound unique keeps workspaceId in the predicate, so this cannot
    // update a member of another workspace even if the id were guessed.
    where: { id: memberId, workspaceId: scope.workspaceId },
    data: { role },
    select: MEMBER_SELECT,
  });
}

/**
 * Soft removal. The row is kept so that re-inviting the same person reactivates a
 * membership rather than colliding with the unique (workspace_id, user_id) index —
 * and so assignment history keeps resolving to a real member.
 */
export function deactivateMember(client: Tx, scope: WorkspaceScope, memberId: string) {
  return client.workspaceMember.update({
    where: { id: memberId, workspaceId: scope.workspaceId },
    data: { status: 'REMOVED' },
    select: { id: true },
  });
}

/**
 * Serializes every membership mutation for one workspace by locking its row.
 *
 * This is what makes the last-Admin guard correct rather than merely present.
 * Without it, two concurrent removals of two different Admins in a workspace that
 * has exactly two both read a count of 2, both decide they are safe, and the
 * workspace ends with zero Admins and no way to recover through the API.
 */
export async function lockWorkspaceForMembershipChange(
  client: Tx,
  workspaceId: string,
): Promise<void> {
  // Parameterized: ${workspaceId} becomes $1 and the cast stays literal SQL.
  await client.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
}
