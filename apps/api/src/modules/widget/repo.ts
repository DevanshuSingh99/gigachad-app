import { db, unscoped, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

export interface ActiveEmbedToken {
  workspaceId: string;
  allowedOrigin: string;
}

/**
 * Widget repository.
 *
 * Every read here is scoped by BOTH workspaceId and contactId, not workspaceId
 * alone — the tenant guard in src/db.ts only enforces the former. A widget token
 * scopes to one contact within its workspace, and a query that forgot the
 * contactId predicate would let one customer read another's conversation in the
 * same workspace, which is exactly what the automated suite's widget-scope tests
 * exist to catch (docs/13-testing-strategy.md, tests 8-9).
 */

const WIDGET_CONVERSATION_SELECT = {
  id: true,
  status: true,
  subject: true,
  lastMessageAt: true,
  customerLastReadSequence: true,
} as const;

/** Cross-tenant by nature: a widget key is what determines the workspace, not the reverse. */
export function findWorkspaceByWidgetKey(widgetKey: string) {
  return unscoped('widget session: resolve workspace from its public widget key', () =>
    db.workspace.findUnique({
      where: { widgetKey },
      select: { id: true, settingsJson: true },
    }),
  );
}

/**
 * Looks up an active per-domain embed token (`wk_embed_…`).
 *
 * Cross-tenant by design — the token itself is what determines which workspace
 * and which allowed origin apply, so this query cannot be pre-scoped.
 */
export function findActiveEmbedToken(token: string): Promise<ActiveEmbedToken | null> {
  return unscoped('widget session: resolve workspace from embed token', () =>
    db.embedToken.findFirst({
      where: { token, isActive: true },
      select: { workspaceId: true, allowedOrigin: true },
    }),
  );
}

/** True when this origin is bound to an active embed token for the workspace. */
export function findActiveEmbedOrigin(workspaceId: string, origin: string) {
  return unscoped('socket handshake: resolve embed origin for workspace', () =>
    db.embedToken.findFirst({
      where: { workspaceId, allowedOrigin: origin, isActive: true },
      select: { id: true },
    }),
  );
}

export function listContactConversations(scope: WorkspaceScope, contactId: string) {
  return db.conversation.findMany({
    where: { workspaceId: scope.workspaceId, contactId },
    select: WIDGET_CONVERSATION_SELECT,
    orderBy: { lastMessageAt: 'desc' },
    take: 25,
  });
}

/** The contact's most recent chat thread, regardless of status — reopening on a new message is messages/service.ts's job, not this lookup's. */
export function findMostRecentChatConversation(
  client: Tx,
  scope: WorkspaceScope,
  contactId: string,
) {
  return client.conversation.findFirst({
    where: { workspaceId: scope.workspaceId, contactId, channel: 'CHAT' },
    select: { id: true },
    orderBy: { lastMessageAt: 'desc' },
  });
}

export function createChatConversation(client: Tx, scope: WorkspaceScope, contactId: string) {
  return client.conversation.create({
    data: { workspaceId: scope.workspaceId, contactId, channel: 'CHAT' },
    select: { id: true },
  });
}

/** Ownership-scoped: a conversation belonging to another contact in the same workspace does not match. */
export function findOwnConversation(scope: WorkspaceScope, contactId: string, conversationId: string) {
  return db.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId, contactId },
    select: WIDGET_CONVERSATION_SELECT,
  });
}

/**
 * Advances customer_last_read_sequence monotonically in one statement, scoped by
 * contact as well as workspace so a token cannot advance another contact's read
 * position. Same GREATEST pattern, and the same raw-query caveat, as
 * conversations/repo.ts's updateAgentReadSequence.
 */
export async function updateCustomerReadSequence(
  scope: WorkspaceScope,
  contactId: string,
  conversationId: string,
  lastReadSequence: number,
): Promise<{ customerLastReadSequence: number } | null> {
  const rows = await db.$queryRaw<Array<{ customerLastReadSequence: number }>>`
    UPDATE conversations
    SET customer_last_read_sequence = GREATEST(customer_last_read_sequence, ${lastReadSequence})
    WHERE id = ${conversationId}::uuid
      AND workspace_id = ${scope.workspaceId}::uuid
      AND contact_id = ${contactId}::uuid
    RETURNING customer_last_read_sequence AS "customerLastReadSequence"
  `;
  return rows[0] ?? null;
}
