import type { NextFunction, Request, Response } from 'express';

import { env } from '../env';
import { AppError } from '../lib/errors';
import { CSRF_COOKIE } from '../lib/cookies';

/**
 * CSRF defense for the dashboard-facing API surface.
 *
 * Strategy: Origin allowlist check, plus a double-submit token, on every
 * state-changing request.
 *
 * Why this works (docs/09-security.md):
 *   - The session lives in an `HttpOnly SameSite=Lax` cookie. `SameSite=Lax`
 *     blocks the cookie on cross-site POSTs from third-party pages, but any
 *     subdomain of the apex is SAME-site (not cross-site). Because the cookie
 *     is `Domain=.example.com`, a compromised or rogue subdomain would be
 *     same-site and Lax would not block it. The Origin check is therefore the
 *     load-bearing CSRF defence, not a backup.
 *   - The token is defense-in-depth for anything the Origin check can't see
 *     (a browser bug, a proxy that strips/rewrites Origin, non-browser
 *     clients that a future feature might trust). `gc_csrf` is a
 *     script-readable, non-HttpOnly cookie the dashboard client reads and
 *     echoes back as `x-csrf-token` (see apps/dashboard/lib/api.ts) — a
 *     cross-site attacker can force the cookie to be *sent* but cannot *read*
 *     it to put the value in a header, which is the entire double-submit
 *     property.
 *   - State-changing methods: POST, PATCH, DELETE, PUT. GET and HEAD are safe
 *     (no writes); OPTIONS is the preflight and the CORS middleware handles it.
 *
 * Exemptions (use separate, non-cookie credentials):
 *   - Widget routes: bearer token in `x-widget-token`, no cookie.
 *   - Webhook routes: provider HMAC, no cookie.
 *   - Public KB: GET-only, read-only.
 *   - Health + internal: no state changes.
 */

const STATE_CHANGING = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

/**
 * Paths that carry their own non-cookie credentials and must never be checked.
 * Prefix-matched so /api/v1/widget/anything and /api/v1/webhooks/anything
 * are both excluded.
 */
const EXEMPT_PREFIXES = [
  '/api/v1/widget/',
  '/api/v1/webhooks/',
  '/internal/',
  '/health/',
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function csrfMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!STATE_CHANGING.has(req.method) || isExempt(req.path)) {
    next();
    return;
  }

  const origin = req.headers.origin;

  // Same-origin requests (server-to-server, health checks, curl without Origin)
  // have no Origin header. Allow them — a browser always sends Origin on
  // cross-origin state-changing requests.
  if (!origin) {
    next();
    return;
  }

  if (origin !== env.DASHBOARD_ORIGIN) {
    req.log?.warn(
      { origin, expected: env.DASHBOARD_ORIGIN, path: req.path },
      'csrf: origin mismatch',
    );
    next(new AppError('CSRF_FAILED'));
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.headers['x-csrf-token'];

  if (
    !cookieToken ||
    typeof headerToken !== 'string' ||
    headerToken.length !== cookieToken.length ||
    headerToken !== cookieToken
  ) {
    req.log?.warn({ path: req.path }, 'csrf: token mismatch');
    next(new AppError('CSRF_FAILED'));
    return;
  }

  next();
}
