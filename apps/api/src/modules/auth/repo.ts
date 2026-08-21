import { db, unscoped, type Tx } from '../../db';

/**
 * Auth repository.
 *
 * Every function here is legitimately cross-tenant — a session or a login happens
 * before any workspace is known — so each one names its reason through
 * `unscoped()`. That is the point of the escape hatch: these reads are auditable
 * by grepping for it, and nothing else in the codebase can query this way by
 * accident.
 */

/** Selected explicitly so the hash is fetched only where a password is verified. */
const CREDENTIAL_SELECT = { id: true, email: true, name: true, passwordHash: true } as const;

export function findUserByEmailForLogin(email: string) {
  return unscoped('login: resolve user by email before any workspace exists', () =>
    db.user.findUnique({ where: { email }, select: CREDENTIAL_SELECT }),
  );
}

export function findUserByEmail(email: string) {
  return unscoped('signup: check whether an email is already registered', () =>
    db.user.findUnique({ where: { email }, select: { id: true } }),
  );
}

export function listMembershipsForUser(userId: string) {
  return unscoped("list one user's own memberships across every workspace", () =>
    db.workspaceMember.findMany({
      where: { userId, status: 'ACTIVE' },
      select: {
        role: true,
        workspaceId: true,
        workspace: { select: { name: true, slug: true, supportAddress: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );
}

export function findWorkspaceBySlug(slug: string) {
  return unscoped('resolve a workspace by its globally unique slug', () =>
    db.workspace.findUnique({ where: { slug }, select: { id: true } }),
  );
}

export function createUser(
  client: Tx,
  data: { email: string; passwordHash: string; name: string },
) {
  return client.user.create({
    data,
    select: { id: true, email: true, name: true },
  });
}
