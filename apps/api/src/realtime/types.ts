import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@gigachad/shared';

/**
 * The authenticated principal a socket carries for its whole lifetime.
 *
 * Set once, in the handshake auth middleware, from the session cookie or the
 * widget bearer token — never from an event payload (docs/18-execution.md,
 * Phase D). `workspaceId` in particular is what every room-join and every
 * handler trusts; it is fixed for the socket's lifetime, so switching workspace
 * in the dashboard reconnects with a new claim rather than mutating a live one.
 */
export type SocketPrincipal =
  | {
      actorType: 'AGENT';
      workspaceId: string;
      userId: string;
      userName: string;
    }
  | {
      actorType: 'WIDGET';
      workspaceId: string;
      contactId: string;
      widgetSessionId: string;
    };

export interface InterServerEvents {
  // Empty: nothing is broadcast server-to-server outside the adapter itself.
}

export interface SocketData {
  principal: SocketPrincipal;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
