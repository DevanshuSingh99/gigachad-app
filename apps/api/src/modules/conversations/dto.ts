import type {
  Channel,
  ConversationDto,
  ConversationStatus,
} from '@gigachad/shared';

export interface ConversationRow {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  contact: { id: string; name: string | null; email: string | null };
  snoozedUntil: Date | null;
  lastMessageAt: Date;
  messageCount: number;
  agentLastReadSequence: number;
  customerLastReadSequence: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Named fields only, contact and assignee included by explicit nested selects
 * (never a bare Prisma include-and-spread) — the inbox list needs both to render
 * without a per-row join, and neither carries anything beyond id/name/email.
 */
export function conversationDto(row: ConversationRow): ConversationDto {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    assigneeId: row.assigneeId,
    assignee: row.assignee,
    contact: row.contact,
    snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    messageCount: row.messageCount,
    agentLastReadSequence: row.agentLastReadSequence,
    customerLastReadSequence: row.customerLastReadSequence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
