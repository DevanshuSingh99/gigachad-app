import type { WidgetConversationDto, WidgetSessionDto } from '@gigachad/shared';

export interface WidgetConversationRow {
  id: string;
  status: WidgetConversationDto['status'];
  subject: string | null;
  lastMessageAt: Date;
  customerLastReadSequence: number;
}

/**
 * No assignee, no internal contact/assignee summaries — a customer has no
 * legitimate use for who on the team is handling it (invariant 6, applied to a
 * narrower DTO than the agent-facing ConversationDto rather than reusing it).
 */
export function widgetConversationDto(row: WidgetConversationRow): WidgetConversationDto {
  return {
    id: row.id,
    status: row.status,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt.toISOString(),
    customerLastReadSequence: row.customerLastReadSequence,
  };
}

export function widgetSessionDto(
  token: string,
  contact: { id: string; name: string | null },
  conversations: WidgetConversationRow[],
): WidgetSessionDto {
  return {
    token,
    // Named fields, not a passthrough: callers hand this whatever shape
    // findOrCreateContact or a full contact row returns, which carries far more
    // than {id, name} (externalKey, identitySource, lastSeenAt, createdAt).
    // TypeScript's structural typing does not strip those at the call site —
    // only naming them explicitly here does (invariant 6).
    contact: { id: contact.id, name: contact.name },
    conversations: conversations.map(widgetConversationDto),
  };
}
