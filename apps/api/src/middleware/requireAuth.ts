import type { NextFunction, Request, Response } from 'express';
import type { WorkspaceRole } from '@gigachad/shared';

import { AppError, forbiddenRole, notFound, unauthenticated } from '../lib/errors';
import { getAuthContext, type AuthContext } from '../lib/authContext';

/**
 * Authorization guards.
 *
 * All three read the request-scoped auth context, which is resolved once and
 * memoized, so a chain like requireAuth → requireMember → requireAdmin performs
 * one session lookup and one membership lookup rather than three of each
 * (docs/17-caching.md).
 *
 * The status codes are the load-bearing part:
 *
 *   401 — no valid session.
 *   404 — valid session, but no membership in the target workspace. NOT 403: a
 *         workspace the caller cannot see must be indistinguishable from one that
 *         does not exist, or the response confirms it exists (invariant 4).
 *   403 — a member whose role is insufficient. Here the resource is legitimately
 *         visible, so saying "wrong role" leaks nothing.
 */

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = await getAuthContext(req);
  if (!auth) {
    next(unauthenticated('no valid session'));
    return;
  }
  req.auth = auth;
  req.logFields = { ...req.logFields, userId: auth.userId, actorType: 'user' };
  next();
}

export async function requireMember(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = await getAuthContext(req);
  if (!auth) {
    next(unauthenticated('no valid session'));
    return;
  }
  if (!auth.membership) {
    // Deliberately 404. See the note above.
    next(notFound('workspace'));
    return;
  }
  req.auth = auth;
  req.logFields = {
    ...req.logFields,
    userId: auth.userId,
    workspaceId: auth.membership.workspaceId,
    actorType: 'user',
  };
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireMember(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    const role = req.auth?.membership?.role;
    if (role !== 'ADMIN') {
      next(forbiddenRole('Admin'));
      return;
    }
    next();
  });
}

/**
 * Reads the context a guard established. Throwing here means a route was mounted
 * without its guard, which is a programming error rather than a client error.
 */
export function authOf(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError('INTERNAL', { message: 'Route is missing requireAuth.' });
  }
  return req.auth;
}

export interface ResolvedMembership {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  role: WorkspaceRole;
}

export function membershipOf(req: Request): ResolvedMembership {
  const membership = authOf(req).membership;
  if (!membership) {
    throw new AppError('INTERNAL', { message: 'Route is missing requireMember.' });
  }
  return membership;
}
