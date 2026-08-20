import type { NextFunction, Request, Response } from 'express';

import { env } from '../env';

/**
 * Credentialed CORS with an explicit origin allowlist.
 *
 * Never `*`. A wildcard is incompatible with `credentials: true`, and on the
 * widget routes it would be a tenant-isolation hole — any site could call them.
 * Every response carries `Vary: Origin` so a shared cache cannot serve one
 * origin's response to another. See docs/05-api.md and docs/10-deployment.md.
 */

const ALLOWED_HEADERS = [
  'content-type',
  'x-workspace-id',
  'x-csrf-token',
  'x-widget-token',
  'x-requested-with',
].join(', ');

const EXPOSED_HEADERS = ['x-request-id', 'retry-after'].join(', ');

/**
 * Resolves whether an origin may call this request. Phase A allows the dashboard
 * only; the widget namespace extends this with each workspace's configured
 * origins, which is why the signature is async and takes the request.
 */
export type OriginResolver = (origin: string, req: Request) => boolean | Promise<boolean>;

export const allowDashboardOrigin: OriginResolver = (origin) => origin === env.DASHBOARD_ORIGIN;

export function corsMiddleware(isAllowed: OriginResolver = allowDashboardOrigin) {
  return async function cors(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Set unconditionally, including when there is no Origin: the decision to
    // vary must be visible on every response, not only the cross-origin ones.
    res.vary('Origin');

    const origin = req.headers.origin;
    if (!origin) {
      // Same-origin navigation, server-to-server, or a health probe.
      next();
      return;
    }

    let allowed = false;
    try {
      allowed = await isAllowed(origin, req);
    } catch (err) {
      req.log?.warn({ err: (err as Error).message }, 'cors origin resolution failed');
      allowed = false;
    }

    if (!allowed) {
      // A rejected preflight answers explicitly so the failure is legible in the
      // browser console instead of surfacing as an opaque network error.
      if (req.method === 'OPTIONS') {
        res.status(403).end();
        return;
      }
      // No CORS headers, so the browser refuses to expose the response. The
      // request itself is stopped for state-changing methods by the CSRF origin
      // check in the hardening phase.
      next();
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }

    next();
  };
}
