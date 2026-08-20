import type { CookieOptions, Response } from 'express';

import { env } from '../env';
import { LIFETIMES } from '@gigachad/shared';

/**
 * Session cookie configuration.
 *
 * The session is an opaque server-side token in an HttpOnly cookie rather than a
 * bearer token in localStorage, which is only possible because the dashboard sits
 * on a subdomain of the API's apex domain: app.<apex> to api.<apex> is same-site,
 * so SameSite=Lax still sends the cookie. On a *.pages.dev URL the request is
 * cross-site, Lax withholds the cookie, and Safari blocks it as third-party
 * regardless — which is why attaching the Pages custom domain is a functional
 * dependency of authentication, not a finishing touch. See docs/10-deployment.md.
 */

export const SESSION_COOKIE = 'gc_session';
export const CSRF_COOKIE = 'gc_csrf';

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Secure is dropped only for local http development; production is HTTPS-only.
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    maxAge: LIFETIMES.sessionDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  // Same attributes as when set, or the browser will not match and clear it.
  res.clearCookie(SESSION_COOKIE, baseOptions());
}

/**
 * The CSRF token is readable by scripts on purpose — the double-submit pattern
 * needs the client to echo it in a header. It is the second half of the defense;
 * the Origin allowlist check is the first and, with a domain-scoped cookie, the
 * load-bearing one (docs/09-security.md).
 */
export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    ...baseOptions(),
    httpOnly: false,
    maxAge: LIFETIMES.sessionDays * 24 * 60 * 60 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE, { ...baseOptions(), httpOnly: false });
}
