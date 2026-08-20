import { LIFETIMES } from '@gigachad/shared';

import { db, unscoped, type Tx } from '../db';
import { generateOpaqueToken, hashToken } from './tokens';

/**
 * Widget session tokens.
 *
 * One opaque token serves two purposes for its entire lifetime: it is the bearer
 * credential on every `/api/v1/widget/*` call and the socket handshake (sent as
 * `x-widget-token`), and it is the resume key the loader stores in the iframe's
 * own `localStorage` for the visitor's next visit. There is no separate rotation
 * — resuming a session returns the same token, just with its expiry slid forward,
 * exactly like the dashboard session in lib/sessions.ts.
 */

export interface CreatedWidgetSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export async function createWidgetSession(
  client: Tx,
  data: { workspaceId: string; contactId: string; userAgent?: string; origin?: string },
): Promise<CreatedWidgetSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + LIFETIMES.widgetSessionHours * 60 * 60 * 1000);

  const session = await client.widgetSession.create({
    data: {
      workspaceId: data.workspaceId,
      contactId: data.contactId,
      publicTokenHash: hashToken(token),
      expiresAt,
      userAgent: data.userAgent,
      origin: data.origin,
    },
    select: { id: true },
  });

  return { sessionId: session.id, token, expiresAt };
}

/**
 * Resolves a widget session by its bearer token — necessarily cross-tenant, since
 * the token itself is what determines the workspace, the same reasoning as
 * resolving a dashboard session by cookie in lib/authContext.ts.
 */
export function findWidgetSessionByToken(token: string) {
  return unscoped('resolve widget session by its bearer token', () =>
    db.widgetSession.findFirst({
      where: { publicTokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      select: { id: true, workspaceId: true, contactId: true, lastSeenAt: true },
    }),
  );
}

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** Slides the expiry forward on activity, mirroring the dashboard session's own sliding touch. */
export async function touchWidgetSession(sessionId: string, lastSeenAt: Date): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() <= TOUCH_INTERVAL_MS) return;
  await unscoped('slide widget session expiry on its own row', () =>
    db.widgetSession.update({
      where: { id: sessionId },
      data: {
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + LIFETIMES.widgetSessionHours * 60 * 60 * 1000),
      },
    }),
  );
}
