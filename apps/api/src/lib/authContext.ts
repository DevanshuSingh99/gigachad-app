import type { Request } from 'express';
import { z } from 'zod';
import type { WorkspaceRole } from '@gigachad/shared';
import { LIFETIMES, uuid } from '@gigachad/shared';

import { db, unscoped } from '../db';
import { SESSION_COOKIE } from './cookies';
import { hashToken } from './tokens';

/**
 * Request-scoped authorization resolution.
 *
 * Resolved once per request and memoized on that request; never cached across
 * requests. That is a correctness decision rather than a performance one: session
 * revocation, role changes, and member removal take effect on the very next
 * request instead of up to a TTL later. A removed member holding access for even
 * 30 seconds is exactly the finding a security reviewer looks for, and no amount
 * of saved latency pays for it. See docs/17-caching.md.
 *
 * Without the memo, a single request that checks a role guard, loads a
 * conversation, and writes a message would repeat the same session and membership
 * lookups three or four times.
 */

export interface AuthContext {
  sessionId: string;
  userId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  /** Present only when the request targets a workspace the user belongs to. */
  membership?: {
    workspaceId: string;
    workspaceSlug: string;
    workspaceName: string;
    role: WorkspaceRole;
  };
}

/** Keyed on the request object, so the cache cannot outlive the request. */
const memo = new WeakMap<Request, Promise<AuthContext | null>>();

/** Sessions slide: a request more than an hour after the last one extends them. */
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function targetWorkspaceId(req: Request): string | null {
  // Workspace routes are mounted with an explicit :workspaceId param rather than
  // :id, so this never picks up some other route's identifier by accident.
  const fromPath = req.params?.workspaceId;
  const candidate = fromPath ?? req.header('x-workspace-id');
  if (!candidate) return null;
  const parsed = uuid.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

async function resolve(req: Request): Promise<AuthContext | null> {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) return null;

  const now = new Date();

  // Sessions are not tenant-owned: the lookup is by token hash, before any
  // workspace is known.
  const session = await unscoped('resolve session by cookie token hash', () =>
    db.session.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: now } },
      select: {
        id: true,
        userId: true,
        lastSeenAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
  );
  if (!session) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await unscoped('slide session expiry on its own row', () =>
      db.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + LIFETIMES.sessionDays * 24 * 60 * 60 * 1000),
        },
      }),
    );
  }

  const context: AuthContext = {
    sessionId: session.id,
    userId: session.userId,
    user: session.user,
  };

  const workspaceId = targetWorkspaceId(req);
  if (!workspaceId) return context;

  // Scoped by construction: workspaceId is in the predicate, so a user who is not
  // a member simply gets no row and the request resolves to "no membership",
  // which the guards turn into 404 rather than 403.
  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: session.userId, status: 'ACTIVE' },
    select: {
      role: true,
      workspaceId: true,
      workspace: { select: { slug: true, name: true } },
    },
  });
  if (!membership) return context;

  return {
    ...context,
    membership: {
      workspaceId: membership.workspaceId,
      workspaceSlug: membership.workspace.slug,
      workspaceName: membership.workspace.name,
      role: membership.role,
    },
  };
}

/** Resolves once per request; every downstream guard, service, and repository reads this. */
export function getAuthContext(req: Request): Promise<AuthContext | null> {
  const existing = memo.get(req);
  if (existing) return existing;
  const pending = resolve(req);
  memo.set(req, pending);
  return pending;
}

/** Test seam: lets a test assert that a second call does not re-query. */
export const __testing = { memo, targetWorkspaceId, schema: z.object({}) };
