import type { CreateMessageInput, MessageDto, MessageListQuery, Page } from '@gigachad/shared';
import { z } from 'zod';

import { db } from '../../db';
import { notFound } from '../../lib/errors';
import { isUniqueViolationOn } from '../../lib/prismaErrors';
import { decodeCursor, requireFound, takeWithLookahead, toPage, type WorkspaceScope } from '../../lib/repo';
import { sanitizeChatMessageHtml } from '../../lib/sanitize';
import { allocateSequenceAndMaybeReopen, findConversationState } from '../conversations/repo';
import { messageDto } from './dto';
import * as repo from './repo';

const messageCursor = z.object({ v: z.literal(1), sequence: z.number().int() });

export async function listMessages(
  scope: WorkspaceScope,
  conversationId: string,
  query: MessageListQuery,
): Promise<Page<MessageDto>> {
  // Existence check so a foreign or nonexistent conversation is 404, not a
  // silently empty page — the two must be indistinguishable either way.
  requireFound(await findConversationState(db, scope, conversationId), 'conversation');

  const afterSequence = query.cursor
    ? decodeCursor(query.cursor, messageCursor).sequence
    : undefined;

  const rows = await repo.listMessages(scope, conversationId, {
    take: takeWithLookahead(query.limit),
    afterSequence,
  });

  return toPage(rows, query.limit, messageDto, (row) => ({ sequence: row.sequence }));
}

export type MessageSender = { type: 'AGENT'; userId: string } | { type: 'CUSTOMER' };

/**
 * Creates a message.
 *
 * Idempotency has two layers, matched to how a retry actually happens:
 *
 * 1. **The common case** — a client retries sequentially after a timeout or a
 *    dropped response. The pre-check finds the already-committed message and
 *    returns it without touching the sequence counter at all.
 * 2. **The rare case** — two requests with the same clientMessageId are
 *    genuinely in flight at once (a double-click, a client bug) and both pass
 *    the pre-check. Both open a transaction; both allocate a sequence; the
 *    second's INSERT hits the unique constraint on (conversationId,
 *    clientMessageId) and throws, which rolls back its ENTIRE transaction —
 *    including its sequence allocation. No gap is left, because the increment
 *    and the insert that could conflict share one transaction.
 *
 * Sequence allocation and the reopen-on-customer-message rule are one atomic
 * UPDATE on the conversation row (allocateSequenceAndMaybeReopen), acquired
 * before the message insert per invariant 3: lock conversations before messages.
 */
export async function createMessage(
  scope: WorkspaceScope,
  conversationId: string,
  input: CreateMessageInput,
  sender: MessageSender,
): Promise<MessageDto> {
  const existing = await repo.findByClientMessageId(db, scope, conversationId, input.clientMessageId);
  if (existing) return messageDto(existing);

  const bodyHtml = input.bodyHtml ? sanitizeChatMessageHtml(input.bodyHtml) : undefined;

  try {
    return await db.$transaction(async (tx) => {
      const allocation = await allocateSequenceAndMaybeReopen(tx, scope, conversationId, sender.type);
      if (!allocation) throw notFound('conversation');

      const created = await repo.insertMessage(tx, {
        workspaceId: scope.workspaceId,
        conversationId,
        senderType: sender.type,
        ...(sender.type === 'AGENT' ? { senderUserId: sender.userId } : {}),
        bodyText: input.bodyText,
        ...(bodyHtml !== undefined ? { bodyHtml } : {}),
        clientMessageId: input.clientMessageId,
        sequence: allocation.sequence,
      });

      return messageDto(created);
    });
  } catch (error) {
    if (isUniqueViolationOn(error, 'clientMessageId')) {
      const winner = await repo.findByClientMessageId(db, scope, conversationId, input.clientMessageId);
      if (winner) return messageDto(winner);
    }
    throw error;
  }
}
