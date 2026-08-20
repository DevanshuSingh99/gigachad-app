import type {
  CreateMessageInput,
  CreateWidgetSessionInput,
  MessageListQuery,
  Page,
  ReadInput,
  WidgetMessageDto,
  WidgetSessionDto,
} from '@gigachad/shared';
import { z } from 'zod';

import { db } from '../../db';
import { AppError, notFound } from '../../lib/errors';
import { decodeCursor, requireFound, takeWithLookahead, toPage, type WorkspaceScope } from '../../lib/repo';
import { createWidgetSession, findWidgetSessionByToken } from '../../lib/widgetTokens';
import { emitMessageRead } from '../../realtime/emit';
import { findOrCreateContact } from '../contacts/repo';
import { parseSettings } from '../workspaces/dto';
import * as messagesRepo from '../messages/repo';
import { widgetMessageDto } from '../messages/dto';
import { createMessage } from '../messages/service';
import { widgetConversationDto, widgetSessionDto } from './dto';
import * as repo from './repo';

/**
 * Creates or resumes a widget session.
 *
 * The `Origin` check happens here and nowhere else in the REST surface — the
 * CORS middleware in front of this route is deliberately permissive (see
 * middleware/cors.ts's widgetCors), so this is the actual security boundary
 * docs/09-security.md describes, not a formality on top of one CORS already
 * enforced.
 *
 * `meta.origin` (from `req.headers.origin`) is only meaningful because
 * apps/widget/src/loader.ts calls this endpoint directly, from code running in
 * the host page's own execution context — never the widget panel, which is
 * same-origin to this app and would make the header say the wrong thing. See
 * the loader's `bootstrapSession` and this project's realtime/auth.ts for the
 * socket-handshake side of the same constraint.
 *
 * Two key formats are accepted:
 *   `wk_live_…`  — workspace-level key; allowed origins come from settingsJson.
 *   `wk_embed_…` — per-domain embed token; allowed origin is stored on the row
 *                  and must match exactly (no list, no wildcard).
 */
export async function createSession(
  input: CreateWidgetSessionInput,
  meta: { origin: string | undefined; userAgent: string | undefined },
): Promise<WidgetSessionDto> {
  let workspaceId: string;

  if (input.widgetKey.startsWith('wk_embed_')) {
    // Per-domain embed token path — stricter than the workspace key: origin must
    // match the single stored value exactly.
    const embedToken = await repo.findActiveEmbedToken(input.widgetKey);
    if (!embedToken) throw notFound('workspace');
    if (!meta.origin || meta.origin !== embedToken.allowedOrigin) {
      throw new AppError('WIDGET_ORIGIN_NOT_ALLOWED', {
        detail: { origin: meta.origin, allowedOrigin: embedToken.allowedOrigin },
      });
    }
    workspaceId = embedToken.workspaceId;
  } else {
    // Workspace-level key path — original behaviour unchanged.
    const workspace = requireFound(await repo.findWorkspaceByWidgetKey(input.widgetKey), 'workspace');
    const settings = parseSettings(workspace.settingsJson);
    if (!meta.origin || !settings.allowedWidgetOrigins.includes(meta.origin)) {
      throw new AppError('WIDGET_ORIGIN_NOT_ALLOWED', {
        detail: { origin: meta.origin, workspaceId: workspace.id },
      });
    }
    workspaceId = workspace.id;
  }

  const scope: WorkspaceScope = { workspaceId };

  // Resume: a token only counts if it actually belongs to this workspace — a
  // token from workspace B presented against workspace A's widget key is
  // treated as absent rather than trusted, per invariant 1.
  if (input.visitorToken) {
    const existing = await findWidgetSessionByToken(input.visitorToken);
    if (existing && existing.workspaceId === workspaceId) {
      const contact = requireFound(
        await db.contact.findFirst({
          where: { id: existing.contactId, workspaceId },
          select: { id: true, name: true },
        }),
        'contact',
      );
      const conversations = await repo.listContactConversations(scope, contact.id);
      return widgetSessionDto(input.visitorToken, contact, conversations);
    }
  }

  // No usable token: a fresh visit. An email links to an existing contact by
  // normalized address (docs/02-product-flows.md); anything else is a brand new
  // anonymous contact.
  const contact = await db.$transaction((tx) =>
    findOrCreateContact(tx, scope, {
      email: input.email,
      name: input.name,
      identitySource: 'WIDGET',
    }),
  );

  const session = await db.$transaction((tx) =>
    createWidgetSession(tx, {
      workspaceId,
      contactId: contact.id,
      userAgent: meta.userAgent,
      origin: meta.origin,
    }),
  );

  return widgetSessionDto(session.token, contact, []);
}

export async function listConversations(scope: WorkspaceScope, contactId: string) {
  return (await repo.listContactConversations(scope, contactId)).map(widgetConversationDto);
}

const messageCursor = z.object({ v: z.literal(1), sequence: z.number().int() });

export async function listMessages(
  scope: WorkspaceScope,
  contactId: string,
  conversationId: string,
  query: MessageListQuery,
): Promise<Page<WidgetMessageDto>> {
  // Ownership, not just workspace membership: a conversation belonging to
  // another contact in the same workspace must 404, identically to a foreign
  // workspace's conversation (docs/13-testing-strategy.md test 9).
  requireFound(await repo.findOwnConversation(scope, contactId, conversationId), 'conversation');

  const afterSequence = query.cursor
    ? decodeCursor(query.cursor, messageCursor).sequence
    : undefined;

  const rows = await messagesRepo.listMessages(scope, conversationId, {
    take: takeWithLookahead(query.limit),
    afterSequence,
  });

  return toPage(rows, query.limit, widgetMessageDto, (row) => ({ sequence: row.sequence }));
}

/**
 * Resolves which conversation a send targets.
 *
 * `"new"` is the sentinel for "no conversation exists yet from the client's
 * point of view" — resolved here to the contact's most recent chat thread, or a
 * freshly created one, rather than the client ever minting or guessing a real
 * conversation id (invariant: never trust a client-supplied conversation id).
 * This is what makes "creates the conversation on first send" (docs/05-api.md)
 * true without ever exposing conversation creation as its own widget-facing
 * endpoint.
 */
async function resolveConversationId(
  scope: WorkspaceScope,
  contactId: string,
  conversationIdOrNew: string,
): Promise<string> {
  if (conversationIdOrNew !== 'new') {
    requireFound(await repo.findOwnConversation(scope, contactId, conversationIdOrNew), 'conversation');
    return conversationIdOrNew;
  }

  return db.$transaction(async (tx) => {
    const existing = await repo.findMostRecentChatConversation(tx, scope, contactId);
    if (existing) return existing.id;
    const created = await repo.createChatConversation(tx, scope, contactId);
    return created.id;
  });
}

export async function sendMessage(
  scope: WorkspaceScope,
  contactId: string,
  conversationIdOrNew: string,
  input: CreateMessageInput,
): Promise<WidgetMessageDto> {
  const conversationId = await resolveConversationId(scope, contactId, conversationIdOrNew);
  const message = await createMessage(scope, conversationId, input, { type: 'CUSTOMER' });
  // createMessage returns the agent-facing DTO; re-shape rather than re-fetch.
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    clientMessageId: message.clientMessageId,
    sequence: message.sequence,
    createdAt: message.createdAt,
  };
}

export async function markRead(
  scope: WorkspaceScope,
  contactId: string,
  conversationId: string,
  input: ReadInput,
): Promise<{ lastReadSequence: number }> {
  requireFound(await repo.findOwnConversation(scope, contactId, conversationId), 'conversation');
  const row = await repo.updateCustomerReadSequence(scope, contactId, conversationId, input.lastReadSequence);
  if (!row) throw notFound('conversation');

  emitMessageRead(scope.workspaceId, conversationId, {
    conversationId,
    lastReadSequence: row.customerLastReadSequence,
    readerType: 'CUSTOMER',
    at: new Date().toISOString(),
  });

  return { lastReadSequence: row.customerLastReadSequence };
}
