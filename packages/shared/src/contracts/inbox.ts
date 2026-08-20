import { z } from 'zod';

import type {
  Channel,
  ConversationStatus,
  DeliveryStatus,
  IdentitySource,
  SenderType,
} from '../enums';
import { channel, conversationStatus } from '../enums';
import { clientMessageId, email, messageText, pagination, personName, uuid } from '../primitives';

/**
 * Inbox contracts: contacts, conversations, messages. Single source of truth the
 * API validates against and the dashboard's client is typed from
 * (docs/18-execution.md).
 */

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const contactListQuery = pagination.extend({
  search: z.string().trim().max(200).optional(),
});
export type ContactListQuery = z.infer<typeof contactListQuery>;

/**
 * Every field optional: a contact identified only by an anonymous widget session
 * may have neither a name nor an email, and this patch is how an agent fills
 * either in without being forced to supply both at once.
 */
export const patchContactInput = z.object({
  name: personName.nullable().optional(),
  email: email.nullable().optional(),
});
export type PatchContactInput = z.infer<typeof patchContactInput>;

export interface ContactDto {
  id: string;
  name: string | null;
  email: string | null;
  externalKey: string | null;
  identitySource: IdentitySource;
  lastSeenAt: string;
  createdAt: string;
}

export interface ContactConversationSummaryDto {
  conversationId: string;
  channel: Channel;
  status: ConversationStatus;
  lastMessageAt: string;
}

/** The single-contact GET response — includes conversation summaries per docs/05-api.md. */
export interface ContactDetailDto extends ContactDto {
  conversations: ContactConversationSummaryDto[];
}

// ─── Conversations ────────────────────────────────────────────────────────────

export const createConversationInput = z.object({
  contactId: uuid,
  channel,
  subject: z.string().trim().max(200).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationInput>;

/** `'unassigned'` is the sentinel for "assigneeId is null" — a real filter value, not the absence of one. */
const assigneeFilter = z.union([z.literal('unassigned'), uuid]);
export type AssigneeFilter = z.infer<typeof assigneeFilter>;

export const conversationListQuery = pagination.extend({
  channel: channel.optional(),
  status: conversationStatus.optional(),
  assigneeId: assigneeFilter.optional(),
});
export type ConversationListQuery = z.infer<typeof conversationListQuery>;

const isoDateTime = z.string().datetime({ offset: true });

/**
 * Shape validation only — `SNOOZED` requiring a future `snoozedUntil`, and the
 * reverse, are state-machine rules that depend on the conversation's *current*
 * stored status, which a schema cannot see. Those are enforced in the service and
 * reported as `INVALID_TRANSITION` rather than `VALIDATION_FAILED`, because they
 * are about what the current state allows, not about the shape of this request.
 */
export const patchConversationInput = z
  .object({
    status: conversationStatus.optional(),
    assigneeId: uuid.nullable().optional(),
    snoozedUntil: isoDateTime.nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.assigneeId !== undefined || v.snoozedUntil !== undefined,
    { message: 'Nothing to update.' },
  );
export type PatchConversationInput = z.infer<typeof patchConversationInput>;

export interface ConversationContactSummaryDto {
  id: string;
  name: string | null;
  email: string | null;
}

export interface ConversationAssigneeSummaryDto {
  id: string;
  name: string;
}

export interface ConversationDto {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  assigneeId: string | null;
  /** Denormalized alongside assigneeId so the inbox list needs no per-row join. */
  assignee: ConversationAssigneeSummaryDto | null;
  contact: ConversationContactSummaryDto;
  snoozedUntil: string | null;
  lastMessageAt: string;
  messageCount: number;
  agentLastReadSequence: number;
  customerLastReadSequence: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export const createMessageInput = z.object({
  bodyText: messageText,
  bodyHtml: z.string().max(64_000).optional(),
  clientMessageId,
});
export type CreateMessageInput = z.infer<typeof createMessageInput>;

export const messageListQuery = pagination;
export type MessageListQuery = z.infer<typeof messageListQuery>;

export const readInput = z.object({ lastReadSequence: z.number().int().min(0) });
export type ReadInput = z.infer<typeof readInput>;

/** The agent/dashboard view: full provenance, including who sent it and its idempotency key. */
export interface MessageDto {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderUserId: string | null;
  senderName: string | null;
  bodyText: string;
  bodyHtml: string | null;
  clientMessageId: string | null;
  sequence: number;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
}

/**
 * The widget/customer view. No `senderUserId` — a customer has no legitimate use
 * for an internal user id, and no `workspaceId` anywhere: both are omitted rather
 * than merely unused, so a future field added to the agent DTO cannot leak into
 * this one by a shared base type. `clientMessageId` stays: it is what lets a
 * customer's own client reconcile an optimistic send.
 */
export interface WidgetMessageDto {
  id: string;
  conversationId: string;
  senderType: SenderType;
  bodyText: string;
  bodyHtml: string | null;
  clientMessageId: string | null;
  sequence: number;
  createdAt: string;
}
