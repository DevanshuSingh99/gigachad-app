import { conversationRoom, typingInput, type TypingPayload } from '@gigachad/shared';

import { logger } from '../../lib/logger';
import { consume } from '../../lib/rateLimit';
import { clearTyping, markTyping } from '../presence';
import type { EnsureSubscribed, IoSocket } from '../types';

/**
 * `typing:start` / `typing:stop`. Fire-and-forget events per the shared contract
 * (no ack) — a dropped typing indicator is not worth retrying.
 *
 * If the client has not finished `conversation:subscribe` yet, we join first so
 * a keystroke right after connect is not silently dropped on the room check.
 */
export function registerTypingHandlers(socket: IoSocket, options: { ensureSubscribed: EnsureSubscribed }): void {
  const participant = () => {
    const p = socket.data.principal;
    return p.actorType === 'AGENT'
      ? { id: p.userId, type: 'AGENT' as const }
      : { id: p.contactId, type: 'CUSTOMER' as const };
  };

  // No ack on either event (fire-and-forget per the shared contract), so the
  // try/catch below exists only to attribute a failure to `typing:start`/
  // `typing:stop` in the logs rather than surfacing as a bare unhandled
  // rejection — there is no client waiting on a response to unblock.
  socket.on('typing:start', async (raw) => {
    try {
      const parsed = typingInput.safeParse(raw);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      if (!(await options.ensureSubscribed(conversationId))) return;

      const { allowed } = await consume('socketTyping', socket.id);
      if (!allowed) return;

      const { workspaceId } = socket.data.principal;
      const { id, type } = participant();
      await markTyping(workspaceId, conversationId, id, type);
      const payload: TypingPayload = { conversationId, participantId: id, participantType: type };
      socket.to(conversationRoom(workspaceId, conversationId)).emit('typing:start', payload);
    } catch (err) {
      logger.error({ err }, 'typing:start failed');
    }
  });

  socket.on('typing:stop', async (raw) => {
    try {
      const parsed = typingInput.safeParse(raw);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      if (!(await options.ensureSubscribed(conversationId))) return;

      const { workspaceId } = socket.data.principal;
      const { id, type } = participant();
      await clearTyping(workspaceId, conversationId, id);
      const payload: TypingPayload = { conversationId, participantId: id, participantType: type };
      socket.to(conversationRoom(workspaceId, conversationId)).emit('typing:stop', payload);
    } catch (err) {
      logger.error({ err }, 'typing:stop failed');
    }
  });
}
