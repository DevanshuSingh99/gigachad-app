import type { Response } from 'express';
import { LIFETIMES } from '@gigachad/shared';

import { db, unscoped, type Tx } from '../db';
import { generateOpaqueToken, hashToken } from './tokens';
import { setCsrfCookie, setSessionCookie } from './cookies';

/**
 * Server-side sessions.
 *
 * The cookie carries an opaque random token; the database stores only its keyed
 * hash. Expiry and revocation are therefore always decided server-side, which is
 * what makes logout and member removal take effect immediately rather than
 * whenever a self-describing token would have expired.
 */

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

/** Accepts a transaction client so signup can create the session atomically with the user. */
export async function createSession(client: Tx, userId: string): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + LIFETIMES.sessionDays * 24 * 60 * 60 * 1000);

  const session = await client.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
    select: { id: true },
  });

  return { sessionId: session.id, token, expiresAt };
}

/**
 * Issues the session cookie plus a CSRF token.
 *
 * The CSRF cookie is script-readable on purpose: the double-submit check needs the
 * client to echo it in a header. It is the second half of the defense — with a
 * domain-scoped session cookie every subdomain is same-site, so the Origin
 * allowlist check is the load-bearing half (docs/09-security.md). The check itself
 * is wired up in the hardening phase; the token is issued here so no session
 * exists without one.
 */
export function issueSessionCookies(res: Response, session: CreatedSession): void {
  setSessionCookie(res, session.token);
  setCsrfCookie(res, generateOpaqueToken(24));
}

export async function revokeSession(sessionId: string): Promise<void> {
  await unscoped('revoke a session by its own id', () =>
    db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
}

/** Used when a member is removed: every session keeps working otherwise. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await unscoped('revoke every session for one user', () =>
    db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  );
}
