import { db, unscoped, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

/**
 * Workspace repository.
 *
 * `workspaces` is the tenant record rather than a tenant-owned row, so it has no
 * workspace_id and the scope guard does not apply to it. Authorization comes from
 * the caller's membership, resolved by requireMember before any of this runs —
 * which is why every read here still takes a WorkspaceScope: it keeps the call
 * sites honest about where the id came from.
 */

const WORKSPACE_SELECT = {
  id: true,
  name: true,
  slug: true,
  widgetKey: true,
  supportAddress: true,
  settingsJson: true,
  createdAt: true,
} as const;

export function findWorkspace(scope: WorkspaceScope) {
  return unscoped('read the workspace record the caller is a member of', () =>
    db.workspace.findUnique({ where: { id: scope.workspaceId }, select: WORKSPACE_SELECT }),
  );
}

export function updateWorkspace(
  scope: WorkspaceScope,
  data: { name?: string; settingsJson?: unknown },
) {
  return unscoped('update the workspace record the caller administers', () =>
    db.workspace.update({
      where: { id: scope.workspaceId },
      data: data as never,
      select: WORKSPACE_SELECT,
    }),
  );
}

export function isSlugTaken(slug: string) {
  return unscoped('check global slug availability before creating a workspace', () =>
    db.workspace.findUnique({ where: { slug }, select: { id: true } }),
  );
}

export function insertWorkspace(
  client: Tx,
  data: {
    name: string;
    slug: string;
    widgetKey: string;
    supportAddress: string;
    settingsJson: unknown;
  },
) {
  return client.workspace.create({ data: data as never, select: WORKSPACE_SELECT });
}

export function insertMembership(
  client: Tx,
  data: { workspaceId: string; userId: string; role: 'ADMIN' | 'AGENT' },
) {
  return client.workspaceMember.create({ data, select: { id: true, role: true } });
}
