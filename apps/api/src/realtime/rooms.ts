import { conversationRoom, workspaceRoom } from '@gigachad/shared';

import { db } from '../db';
import { findConversationState } from '../modules/conversations/repo';
import { findOwnConversation } from '../modules/widget/repo';
import type { IoSocket } from './types';

/**
 * Scoped room joins. Docs/06-realtime.md: "A client-supplied conversation ID
 * cannot cause a room join until the scoped lookup succeeds" — every function
 * here does the lookup first and only calls `socket.join()` on success, so a
 * room name is never handed out on trust.
 */

/** Agents join their workspace room immediately on connect (docs/06-realtime.md step 3). */
export async function joinWorkspaceRoom(socket: IoSocket): Promise<void> {
  if (socket.data.principal.actorType !== 'AGENT') return;
  await socket.join(workspaceRoom(socket.data.principal.workspaceId));
}

/**
 * Joins a specific conversation's room, after verifying the socket's principal
 * may actually see it: workspace membership for an agent (any agent sees every
 * workspace conversation, per docs/02-product-flows.md), contact ownership for a
 * widget socket (a customer sees only their own).
 *
 * Returns the conversation's current state on success so the caller can build a
 * `conversation:sync` payload from it, or `null` if the lookup failed — the
 * caller turns that into a `message:failed`-shaped ack error rather than ever
 * joining the room.
 */
export async function joinConversationRoom(
  socket: IoSocket,
  conversationId: string,
): Promise<{ id: string } | null> {
  const principal = socket.data.principal;
  const scope = { workspaceId: principal.workspaceId };

  const conversation =
    principal.actorType === 'AGENT'
      ? await findConversationState(db, scope, conversationId)
      : await findOwnConversation(scope, principal.contactId, conversationId);

  if (!conversation) return null;

  // Redis adapter: join is async. Callers that check `socket.rooms` or emit
  // into the room must await this, or typing/presence events are silently dropped.
  await socket.join(conversationRoom(principal.workspaceId, conversationId));
  return { id: conversation.id };
}
