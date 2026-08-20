import {
  conversationSubscribeInput,
  REALTIME,
  type ConversationSyncPayload,
  type MessageNewPayload,
} from '@gigachad/shared';

import * as messagesRepo from '../../modules/messages/repo';
import { joinConversationRoom } from '../rooms';
import type { IoSocket } from '../types';

function toSyncMessage(row: {
  id: string;
  conversationId: string;
  sequence: number;
  senderType: MessageNewPayload['senderType'];
  bodyText: string;
  bodyHtml: string | null;
  createdAt: Date;
}): MessageNewPayload {
  return {
    messageId: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    senderType: row.senderType,
    bodyText: row.bodyText,
    ...(row.bodyHtml ? { bodyHtml: row.bodyHtml } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `conversation:subscribe` — the reconnect and initial-load catch-up path.
 *
 * The room join only happens after `joinConversationRoom`'s scoped lookup
 * succeeds, so a client-supplied conversation id cannot cause a join on trust
 * (docs/06-realtime.md). Capped at `REALTIME.syncMessageCap`: a client behind by
 * more than that gets `truncated: true` and is expected to fall back to the
 * cursor-paginated HTTP endpoint rather than the socket trying to catch up an
 * arbitrarily long absence in one payload.
 */
export interface ConversationHandlerOptions {
  /** Invoked after a successful join, so the caller can register presence and track membership for the heartbeat/disconnect cleanup in handlers/connection.ts. */
  onSubscribed?: (conversationId: string) => void | Promise<void>;
}

export function registerConversationHandlers(socket: IoSocket, options: ConversationHandlerOptions = {}): void {
  socket.on('conversation:subscribe', async (raw, ack) => {
    const parsed = conversationSubscribeInput.safeParse(raw);
    if (!parsed.success) {
      ack?.({ ok: false, code: 'VALIDATION_FAILED', message: 'Invalid subscribe payload.' });
      return;
    }
    const { conversationId, lastSequence } = parsed.data;

    const joined = await joinConversationRoom(socket, conversationId);
    if (!joined) {
      ack?.({ ok: false, code: 'NOT_FOUND', message: 'Conversation not found.' });
      return;
    }

    const scope = { workspaceId: socket.data.principal.workspaceId };
    const rows = await messagesRepo.listMessages(scope, conversationId, {
      take: REALTIME.syncMessageCap + 1,
      afterSequence: lastSequence,
    });

    const truncated = rows.length > REALTIME.syncMessageCap;
    const page = truncated ? rows.slice(0, REALTIME.syncMessageCap) : rows;
    const newLastSequence = page.length > 0 ? page[page.length - 1]!.sequence : lastSequence;

    const payload: ConversationSyncPayload = {
      conversationId,
      afterSequence: lastSequence,
      messages: page.map(toSyncMessage),
      lastSequence: newLastSequence,
      truncated,
    };

    ack?.({ ok: true, data: { conversationId, lastSequence: newLastSequence } });
    socket.emit('conversation:sync', payload);
    await options.onSubscribed?.(conversationId);
  });
}
