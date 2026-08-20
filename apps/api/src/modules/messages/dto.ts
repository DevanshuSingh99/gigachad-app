import type { DeliveryStatus, MessageDto, SenderType, WidgetMessageDto } from '@gigachad/shared';

export interface MessageRow {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderUserId: string | null;
  senderUser: { name: string } | null;
  bodyText: string;
  bodyHtml: string | null;
  clientMessageId: string | null;
  sequence: number;
  deliveryStatus: DeliveryStatus;
  createdAt: Date;
}

/** The agent/dashboard view. */
export function messageDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: row.senderType,
    senderUserId: row.senderUserId,
    senderName: row.senderUser?.name ?? null,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    clientMessageId: row.clientMessageId,
    sequence: row.sequence,
    deliveryStatus: row.deliveryStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The widget/customer view — built now, wired to a route in Phase D. No
 * senderUserId: a customer has no legitimate use for an internal user id.
 */
export function widgetMessageDto(row: MessageRow): WidgetMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: row.senderType,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    clientMessageId: row.clientMessageId,
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
  };
}
