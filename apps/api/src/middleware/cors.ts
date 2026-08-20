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

export interface CorsOptions {
  /** Default true, matching the dashboard's cookie-based auth. */
  credentials?: boolean;
}

export function corsMiddleware(
  isAllowed: OriginResolver = allowDashboardOrigin,
  options: CorsOptions = {},
) {
  const credentials = options.credentials ?? true;

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
    if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
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

/**
 * The widget namespace's CORS is deliberately permissive at the transport layer
 * — any origin gets a response it can read — because these routes carry no
 * cookie and therefore no ambient authority a permissive origin could ride on.
 * Authentication is a bearer token in `x-widget-token`; a page has to already
 * possess it to do anything.
 *
 * The actual security boundary docs/09-security.md describes — checking a
 * requesting `Origin` against the workspace's `allowedWidgetOrigins` — happens
 * in application code at exactly the two points the docs name: widget session
 * creation and the socket handshake. It cannot happen here: a CORS preflight has
 * no body, so at the time this middleware runs there is no widget key yet to
 * resolve a workspace from, let alone that workspace's allowlist. This
 * middleware answers "can the browser read this response at all"; the handler
 * answers "should this workspace be reachable from this origin", which is the
 * question that actually matters.
 */
export const widgetCors = corsMiddleware(() => true, { credentials: false });
