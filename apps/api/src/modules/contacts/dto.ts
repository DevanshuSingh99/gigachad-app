import type {
  ContactConversationSummaryDto,
  ContactDetailDto,
  ContactDto,
  IdentitySource,
} from '@gigachad/shared';

export interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  externalKey: string | null;
  identitySource: IdentitySource;
  lastSeenAt: Date;
  createdAt: Date;
}

export function contactDto(row: ContactRow): ContactDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    externalKey: row.externalKey,
    identitySource: row.identitySource,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ContactConversationSummaryRow {
  id: string;
  channel: ContactConversationSummaryDto['channel'];
  status: ContactConversationSummaryDto['status'];
  lastMessageAt: Date;
}

export function contactDetailDto(
  contact: ContactRow,
  conversations: ContactConversationSummaryRow[],
): ContactDetailDto {
  return {
    ...contactDto(contact),
    conversations: conversations.map((c) => ({
      conversationId: c.id,
      channel: c.channel,
      status: c.status,
      lastMessageAt: c.lastMessageAt.toISOString(),
    })),
  };
}
