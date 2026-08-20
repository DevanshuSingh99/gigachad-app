import { db, unscoped } from '../db';
import { readCookie } from '../lib/cookieHeader';
import { env } from '../env';
import { SESSION_COOKIE } from '../lib/cookies';
import { logger } from '../lib/logger';
import { hashToken } from '../lib/tokens';
import { findWidgetSessionByToken, touchWidgetSession } from '../lib/widgetTokens';
import { parseSettings } from '../modules/workspaces/dto';
import { findActiveEmbedOrigin } from '../modules/widget/repo';
import type { IoSocket, SocketPrincipal } from './types';

/**
 * Socket handshake authentication.
 *
 * The transport-level CORS for this server is deliberately permissive (see
 * io.ts) for the same reason middleware/cors.ts's widgetCors is: a widget socket
 * can come from any customer origin, and Socket.IO sends the auth payload as
 * part of the Socket.IO protocol handshake *after* the underlying transport
 * already connected, so there is nothing at the CORS layer to check it against
 * yet. This middleware is therefore the actual security boundary for both kinds
 * of socket, not a formality on top of one CORS already enforced:
 *
 *   - a widget socket's Origin must appear in ITS workspace's
 *     `allowedWidgetOrigins`, resolved only after the token names the workspace;
 *   - a dashboard socket's Origin must be exactly `DASHBOARD_ORIGIN` — checked
 *     explicitly rather than relying on the session cookie's `SameSite=Lax`,
 *     because a WebSocket upgrade is a simple cross-site GET, which Lax does not
 *     block. This is the same reasoning docs/09-security.md gives for why the
 *     Origin check is CSRF's actual defense, extended to sockets.
 *
 * A socket that fails here never reaches `io.on('connection', ...)` — Socket.IO
 * turns a `next(error)` here into a `connect_error` on the client and closes the
 * transport, so no room is ever joined and no handler ever runs for it.
 */
export async function socketAuthMiddleware(socket: IoSocket, next: (err?: Error) => void): Promise<void> {
  try {
    const origin = socket.handshake.headers.origin;
    const auth = socket.handshake.auth as { widgetToken?: unknown; workspaceId?: unknown; origin?: unknown };

    if (typeof auth.widgetToken === 'string' && auth.widgetToken.length > 0) {
      // Deliberately NOT `origin` (the real header) here — that header reflects
      // whatever origin opened the WebSocket, which for this connection is
      // always OUR OWN app's origin: the socket is opened from inside the panel
      // iframe, which is same-origin to this app, not to the host page that
      // embeds it. There is no way to make a WebSocket handshake carry the host
      // page's real origin the way apps/widget/src/loader.ts's REST fetch does
      // (relaying a socket through the loader would mean bundling
      // socket.io-client into the 15KB-budgeted loader). So the widget path
      // trusts a client-reported `auth.origin` instead — a narrower, cooperative
      // check rather than a browser-enforced one. What actually protects this
      // connection either way is the short-lived, contact-scoped bearer token;
      // the origin check here is defense in depth, not the primary gate the
      // dashboard path below relies on.
      const claimedOrigin = typeof auth.origin === 'string' ? auth.origin : undefined;
      const principal = await authenticateWidget(auth.widgetToken, claimedOrigin);
      socket.data.principal = principal;
      next();
      return;
    }

    const principal = await authenticateDashboard(socket, origin, auth.workspaceId);
    socket.data.principal = principal;
    next();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'socket handshake rejected');
    next(new Error('unauthenticated'));
  }
}

async function authenticateWidget(token: string, origin: string | undefined): Promise<SocketPrincipal> {
  const session = await findWidgetSessionByToken(token);
  if (!session) throw new Error('invalid widget token');

  const workspace = await unscoped('socket handshake: resolve widget origin allowlist', () =>
    db.workspace.findUnique({ where: { id: session.workspaceId }, select: { settingsJson: true } }),
  );
  const settings = parseSettings(workspace?.settingsJson);
  const onWorkspaceAllowlist = Boolean(origin && settings.allowedWidgetOrigins.includes(origin));
  const onEmbedAllowlist = origin
    ? Boolean(await findActiveEmbedOrigin(session.workspaceId, origin))
    : false;
  if (!onWorkspaceAllowlist && !onEmbedAllowlist) {
    throw new Error('origin not allowed');
  }

  await touchWidgetSession(session.id, session.lastSeenAt);

  return {
    actorType: 'WIDGET',
    workspaceId: session.workspaceId,
    contactId: session.contactId,
    widgetSessionId: session.id,
  };
}

async function authenticateDashboard(
  socket: IoSocket,
  origin: string | undefined,
  claimedWorkspaceId: unknown,
): Promise<SocketPrincipal> {
  if (origin !== env.DASHBOARD_ORIGIN) throw new Error('origin not allowed');
  if (typeof claimedWorkspaceId !== 'string' || claimedWorkspaceId.length === 0) {
    throw new Error('workspaceId is required');
  }

  const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
  if (!token) throw new Error('no session cookie');

  const session = await unscoped('socket handshake: resolve session by cookie token hash', () =>
    db.session.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
      select: { userId: true, user: { select: { name: true } } },
    }),
  );
  if (!session) throw new Error('invalid or expired session');

  // The claim is verified, not trusted: a session proves who the user is, not
  // which of their workspaces this connection speaks for (invariant 1).
  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId: claimedWorkspaceId, userId: session.userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!membership) throw new Error('not a member of the claimed workspace');

  return {
    actorType: 'AGENT',
    workspaceId: claimedWorkspaceId,
    userId: session.userId,
    userName: session.user.name,
  };
}
