import { z } from 'zod';

import { email, personName } from '../primitives';
import type { ConversationDto, MessageDto, WidgetMessageDto } from './inbox';

/**
 * Widget contracts. The widget namespace never accepts a workspace or contact id
 * from the client (docs/05-api.md) — every one of these carries only what the
 * customer's browser is allowed to know: the public widget key, and its own
 * previously-issued visitor token.
 */

export const widgetKeyPattern = z.string().trim().regex(/^wk_live_[a-f0-9]{32}$/, 'Invalid widget key.');

/**
 * `visitorToken` is the opaque token from a PRIOR session, sent back to resume
 * it. Omitted on a first visit, in which case the server mints a new contact and
 * session. Name/email are optional pre-fill (e.g. a host page that already knows
 * its logged-in user) — never required, since most chat starts are anonymous.
 */
export const createWidgetSessionInput = z.object({
  widgetKey: widgetKeyPattern,
  visitorToken: z.string().min(16).max(200).optional(),
  name: personName.optional(),
  email: email.optional(),
});
export type CreateWidgetSessionInput = z.infer<typeof createWidgetSessionInput>;

export interface WidgetSessionDto {
  /** Opaque bearer token for every subsequent /api/v1/widget/* call and the socket handshake. */
  token: string;
  contact: { id: string; name: string | null };
  /** This visitor's own conversations, most recent first — empty on a first visit. */
  conversations: WidgetConversationDto[];
}

/**
 * A trimmed conversation view for the customer's own conversation list. No
 * assignee, no internal contact/assignee summaries — a customer has no
 * legitimate use for who on the team is handling it.
 */
export interface WidgetConversationDto {
  id: string;
  status: ConversationDto['status'];
  subject: string | null;
  lastMessageAt: string;
  customerLastReadSequence: number;
}

export type { MessageDto, WidgetMessageDto };
