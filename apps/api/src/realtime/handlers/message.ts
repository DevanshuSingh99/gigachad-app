import { messageReadInput, messageSendInput, type MessageAcceptedPayload } from '@gigachad/shared';

import { AppError } from '../../lib/errors';
import { consume } from '../../lib/rateLimit';
import { markConversationRead } from '../../modules/conversations/service';
import { findOwnConversation } from '../../modules/widget/repo';
import { createMessage } from '../../modules/messages/service';
import { markRead as markWidgetRead } from '../../modules/widget/service';
import type { IoSocket } from '../types';

/**
 * `message:send` → persist → `message:accepted` ack. `message:new` is NOT
 * broadcast here — `createMessage` (modules/messages/service.ts) does that
 * itself, after its transaction commits, regardless of whether the call
 * originated from this socket handler or the REST route. That is deliberate:
 * "persist, then emit" (invariant 2) is a property of the write path, not of
 * whichever transport happened to invoke it. This handler's only job is the
 * parts that ARE socket-specific — parsing the payload, rate-limiting per
 * socket, and acknowledging.
 *
 * The acknowledgement is sent only after the service call resolves, which only
 * happens after the transaction commits — never before, which is what makes a
 * client's retry after an ambiguous failure safe rather than a guess.
 */
export function registerMessageHandlers(socket: IoSocket): void {
  socket.on('message:send', async (raw, ack) => {
    const parsed = messageSendInput.safeParse(raw);
    if (!parsed.success) {
      ack?.({ ok: false, code: 'VALIDATION_FAILED', message: 'Invalid message payload.' });
      return;
    }
    const { conversationId, clientMessageId, bodyText, bodyHtml } = parsed.data;
    const principal = socket.data.principal;
    const scope = { workspaceId: principal.workspaceId };

    const { allowed, retryAfterSeconds } = await consume('socketMessageSend', socket.id);
    if (!allowed) {
      ack?.({ ok: false, code: 'RATE_LIMITED', message: `Too many messages. Try again in ${retryAfterSeconds}s.` });
      return;
    }

    try {
      // Ownership, not just workspace membership, for a widget socket: without
      // this check a customer could address any conversationId in their own
      // workspace and have it accepted as a message from them — exactly the
      // widget-scope hole docs/13-testing-strategy.md test 9 exists to catch.
      // An agent needs no equivalent check: any agent may message any
      // conversation in their own workspace (docs/02-product-flows.md), and
      // createMessage's own lookup is already workspace-scoped.
      if (principal.actorType === 'WIDGET') {
        const owned = await findOwnConversation(scope, principal.contactId, conversationId);
        if (!owned) {
          ack?.({ ok: false, code: 'NOT_FOUND', message: 'Conversation not found.' });
          return;
        }
      }

      const sender =
        principal.actorType === 'AGENT'
          ? ({ type: 'AGENT', userId: principal.userId } as const)
          : ({ type: 'CUSTOMER' } as const);

      const message = await createMessage(scope, conversationId, { bodyText, bodyHtml, clientMessageId }, sender);

      const acceptedPayload: MessageAcceptedPayload = {
        clientMessageId,
        messageId: message.id,
        conversationId,
        sequence: message.sequence,
        createdAt: message.createdAt,
      };
      ack?.({ ok: true, data: acceptedPayload });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'INTERNAL';
      const errMessage = err instanceof AppError ? err.message : 'Could not send that message.';
      ack?.({ ok: false, code, message: errMessage });
    }
  });

  socket.on('message:read', async (raw, ack) => {
    const parsed = messageReadInput.safeParse(raw);
    if (!parsed.success) {
      ack?.({ ok: false, code: 'VALIDATION_FAILED', message: 'Invalid read payload.' });
      return;
    }
    const { conversationId, lastReadSequence } = parsed.data;
    const principal = socket.data.principal;
    const scope = { workspaceId: principal.workspaceId };

    try {
      const result =
        principal.actorType === 'AGENT'
          ? await markConversationRead(scope, conversationId, { lastReadSequence })
          : await markWidgetRead(scope, principal.contactId, conversationId, { lastReadSequence });
      ack?.({ ok: true, data: result });
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'INTERNAL';
      const errMessage = err instanceof AppError ? err.message : 'Could not update read position.';
      ack?.({ ok: false, code, message: errMessage });
    }
  });
}
