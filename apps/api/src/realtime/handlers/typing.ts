import { conversationRoom, typingInput, type TypingPayload } from '@gigachad/shared';

import { consume } from '../../lib/rateLimit';
import { clearTyping, markTyping } from '../presence';
import type { IoSocket } from '../types';

/**
 * `typing:start` / `typing:stop`. Fire-and-forget events per the shared contract
 * (no ack) — a dropped typing indicator is not worth retrying.
 *
 * Authorization piggybacks on room membership rather than re-running the scoped
 * lookup: `conversation:subscribe` already proved this socket may see the
 * conversation before it was allowed to join that room, so "is this socket in
 * the room" is a cheap, correct proxy for "is this socket authorized" — a socket
 * that never subscribed silently has its typing events dropped instead of
 * broadcasting for a conversation it was never let into.
 */
export function registerTypingHandlers(socket: IoSocket): void {
  const participant = () => {
    const p = socket.data.principal;
    return p.actorType === 'AGENT'
      ? { id: p.userId, type: 'AGENT' as const }
      : { id: p.contactId, type: 'CUSTOMER' as const };
  };

  socket.on('typing:start', async (raw) => {
    const parsed = typingInput.safeParse(raw);
    if (!parsed.success) return;
    const { conversationId } = parsed.data;
    const { workspaceId } = socket.data.principal;
    const room = conversationRoom(workspaceId, conversationId);
    if (!socket.rooms.has(room)) return;

    const { allowed } = await consume('socketTyping', socket.id);
    if (!allowed) return;

    const { id, type } = participant();
    await markTyping(workspaceId, conversationId, id);
    const payload: TypingPayload = { conversationId, participantId: id, participantType: type };
    socket.to(room).emit('typing:start', payload);
  });

  socket.on('typing:stop', async (raw) => {
    const parsed = typingInput.safeParse(raw);
    if (!parsed.success) return;
    const { conversationId } = parsed.data;
    const { workspaceId } = socket.data.principal;
    const room = conversationRoom(workspaceId, conversationId);
    if (!socket.rooms.has(room)) return;

    const { id, type } = participant();
    await clearTyping(workspaceId, conversationId, id);
    const payload: TypingPayload = { conversationId, participantId: id, participantType: type };
    socket.to(room).emit('typing:stop', payload);
  });
}
