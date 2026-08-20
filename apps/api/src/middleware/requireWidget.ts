import type { NextFunction, Request, Response } from 'express';

import { unauthenticated } from '../lib/errors';
import { findWidgetSessionByToken, touchWidgetSession } from '../lib/widgetTokens';

/**
 * Widget authentication. The header name matches the CORS allowlist in
 * middleware/cors.ts and the socket handshake's `auth.token` — one bearer token,
 * three transports.
 *
 * There is no membership or role to resolve here, unlike requireMember: the
 * token itself already names one workspace and one contact, which is the whole
 * point of the widget namespace never accepting either from the client
 * (docs/05-api.md).
 */
export interface WidgetContext {
  sessionId: string;
  workspaceId: string;
  contactId: string;
}

export async function requireWidget(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.header('x-widget-token');
  if (!token) {
    next(unauthenticated('missing widget token'));
    return;
  }

  const session = await findWidgetSessionByToken(token);
  if (!session) {
    next(unauthenticated('invalid or expired widget token'));
    return;
  }

  await touchWidgetSession(session.id, session.lastSeenAt);

  req.widget = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    contactId: session.contactId,
  };
  req.logFields = {
    ...req.logFields,
    workspaceId: session.workspaceId,
    actorType: 'widget',
  };
  next();
}

export function widgetOf(req: Request): WidgetContext {
  if (!req.widget) {
    throw new Error('Route is missing requireWidget.');
  }
  return req.widget;
}
