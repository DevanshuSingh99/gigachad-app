import type { MemberDto } from '@gigachad/shared';

import { db } from '../../db';
import { AppError } from '../../lib/errors';
import { requireFound, type WorkspaceScope } from '../../lib/repo';
import { memberDto } from './dto';
import * as repo from './repo';

export async function listMembers(scope: WorkspaceScope): Promise<MemberDto[]> {
  return (await repo.listMembers(scope)).map(memberDto);
}

/**
 * Changes a member's role.
 *
 * The last-Admin check runs inside the transaction, after locking the workspace
 * row. Outside a transaction the check is decoration: two concurrent demotions
 * both read "2 Admins", both proceed, and the workspace is left with none.
 */
export async function setRole(
  scope: WorkspaceScope,
  memberId: string,
  role: 'ADMIN' | 'AGENT',
): Promise<MemberDto> {
  return db.$transaction(async (tx) => {
    await repo.lockWorkspaceForMembershipChange(tx, scope.workspaceId);

    const member = requireFound(await repo.findMember(tx, scope, memberId), 'member');

    if (member.role === role) return memberDto(member);

    if (member.role === 'ADMIN' && role === 'AGENT') {
      const admins = await repo.countActiveAdmins(tx, scope);
      if (admins <= 1) {
        throw new AppError('LAST_ADMIN', {
          message: 'This is the only Admin. Promote someone else before changing this role.',
        });
      }
    }

    return memberDto(await repo.setMemberRole(tx, scope, memberId, role));
  });
}

/**
 * Removes a member.
 *
 * Sessions are deliberately not revoked: the user may belong to other workspaces,
 * and access to this one already ends on their very next request because the auth
 * context resolves membership per request and filters on ACTIVE status. Nothing is
 * cached across requests, so there is no stale-authorization window to close
 * (docs/17-caching.md).
 */
export async function removeMember(scope: WorkspaceScope, memberId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await repo.lockWorkspaceForMembershipChange(tx, scope.workspaceId);

    const member = requireFound(await repo.findMember(tx, scope, memberId), 'member');

    if (member.role === 'ADMIN') {
      const admins = await repo.countActiveAdmins(tx, scope);
      if (admins <= 1) {
        throw new AppError('LAST_ADMIN', {
          message: 'A workspace must keep at least one Admin. Promote someone else first.',
        });
      }
    }

    await repo.deactivateMember(tx, scope, memberId);
  });
}
