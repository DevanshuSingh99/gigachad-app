import { z } from 'zod';

import type { DeliveryStatus } from '../enums';
import { clientMessageId, messageText } from '../primitives';

/**
 * Email channel contracts.
 *
 * Agent-facing inputs are validated against these schemas at the API boundary
 * and the dashboard client is typed from the same definitions.
 */

// ─── Inputs ───────────────────────────────────────────────────────────────────

/**
 * An agent's outbound email reply.
 *
 * `htmlContent` is optional because many agents write plain text. When supplied
 * it is sanitized server-side before storage and before send.
 */
export const emailReplyInput = z.object({
  bodyText: messageText,
  bodyHtml: z.string().max(64_000).optional(),
  clientMessageId,
});
export type EmailReplyInput = z.infer<typeof emailReplyInput>;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

/** Delivery state for an outbound email message, surfaced in the inbox. */
export interface EmailMessageMetaDto {
  messageId: string;
  deliveryStatus: DeliveryStatus;
  direction: 'INBOUND' | 'OUTBOUND';
  fromAddress: string;
  sentAt: string | null;
}
