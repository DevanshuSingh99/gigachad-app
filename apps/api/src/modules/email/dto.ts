import type { DeliveryStatus, MessageDto } from '@gigachad/shared';
import type { EmailMessageMetaDto } from '@gigachad/shared';

// ─── EmailMessage DTO ─────────────────────────────────────────────────────────

export interface EmailMessageMetaRow {
  messageId: string;
  deliveryStatus: DeliveryStatus;
  direction: string;
  fromAddress: string;
  sentAt: Date | null;
}

export function emailMessageMetaDto(row: EmailMessageMetaRow): EmailMessageMetaDto {
  return {
    messageId: row.messageId,
    deliveryStatus: row.deliveryStatus,
    direction: row.direction as 'INBOUND' | 'OUTBOUND',
    fromAddress: row.fromAddress,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  };
}

// ─── Ingest result ─────────────────────────────────────────────────────────────

/**
 * Returned by the ingest service after successfully processing an inbound email.
 * Contains the created inbox message DTO plus the conversation ID so the route
 * can emit the appropriate realtime signals.
 */
export interface IngestResult {
  conversationId: string;
  message: MessageDto;
  isNewConversation: boolean;
}
