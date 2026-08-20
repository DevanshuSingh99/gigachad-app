'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@gigachad/shared';

/**
 * The dashboard's socket connection.
 *
 * One socket per active workspace, not per component: switching workspaces
 * disconnects and reconnects with a new `workspaceId` claim rather than mutating
 * a live connection, because the server derives and fixes a socket's workspace
 * at handshake time and never re-evaluates it (docs/06-realtime.md,
 * apps/api/src/realtime/auth.ts). A module-level singleton (rather than one
 * socket per mounted component) is what makes that claim consistent no matter
 * how many components want a socket at once.
 */

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let currentSocket: AppSocket | null = null;
let currentWorkspaceId: string | null = null;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

export function getSocket(workspaceId: string): AppSocket {
  if (!WS_URL) {
    throw new Error('NEXT_PUBLIC_WS_URL is not set. See apps/dashboard/.env.example');
  }
  if (currentSocket && currentWorkspaceId === workspaceId) return currentSocket;

  currentSocket?.disconnect();

  currentSocket = io(WS_URL, {
    // Carries the session cookie on the handshake — the server reads it from
    // there, never from this `auth` payload, which only carries the workspace
    // claim (docs/06-realtime.md: "It derives workspaceId; clients cannot
    // choose it" — the server still verifies membership before trusting this).
    withCredentials: true,
    auth: { workspaceId },
    reconnectionDelay: 500,
    reconnectionDelayMax: 8_000,
  }) as AppSocket;
  currentWorkspaceId = workspaceId;

  return currentSocket;
}

export function disconnectSocket(): void {
  currentSocket?.disconnect();
  currentSocket = null;
  currentWorkspaceId = null;
}
