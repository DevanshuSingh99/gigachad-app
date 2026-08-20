import { z } from 'zod';

import { clientMessageId, messageText, uuid } from './primitives';
import type { ErrorCode } from './errors';
import type { ConversationStatus, SenderType } from './enums';

/**
 * Socket event contract. Single source of truth for the event list and semantics:
 * docs/06-realtime.md.
 *
 * Client-to-server payloads get Zod schemas because they cross a trust boundary
 * and are parsed on arrival. Server-to-client payloads are types only.
 *
 * Note what is absent from every payload: `workspaceId`. The server derives it
 * from the authenticated principal and stores it on the socket. Reading it from
 * an event payload would be a cross-tenant hole that looks like ordinary code
 * (docs/18-execution.md, Phase D).
 */

export const SOCKET_PROTOCOL_VERSION = 1;

export type ParticipantType = 'AGENT' | 'CUSTOMER';

// ── Client → server ────────────────────────────────────────────────────────────

export const conversationSubscribeInput = z.object({
  conversationId: uuid,
  /** Highest sequence the client already holds; 0 when it holds nothing. */
  lastSequence: z.number().int().min(0),
});
export type ConversationSubscribeInput = z.infer<typeof conversationSubscribeInput>;

export const messageSendInput = z.object({
  conversationId: uuid,
  clientMessageId,
  bodyText: messageText,
  bodyHtml: z.string().max(64_000).optional(),
});
export type MessageSendInput = z.infer<typeof messageSendInput>;

export const typingInput = z.object({ conversationId: uuid });
export type TypingInput = z.infer<typeof typingInput>;

export const messageReadInput = z.object({
  conversationId: uuid,
  lastReadSequence: z.number().int().min(0),
});
export type MessageReadInput = z.infer<typeof messageReadInput>;

// ── Server → client ───────────────────────────────────────────────────────────

export interface ConversationSubscribedPayload {
  conversationId: string;
  lastSequence: number;
}

export interface MessageAcceptedPayload {
  clientMessageId: string;
  messageId: string;
  conversationId: string;
  sequence: number;
  createdAt: string;
}

export interface MessageNewPayload {
  messageId: string;
  conversationId: string;
  sequence: number;
  senderType: SenderType;
  bodyText: string;
  bodyHtml?: string;
  createdAt: string;
}

export interface MessageFailedPayload {
  clientMessageId: string;
  code: ErrorCode;
  message: string;
}

export interface PresenceUpdatePayload {
  conversationId: string;
  participantId: string;
  participantType: ParticipantType;
  status: 'ONLINE' | 'OFFLINE';
  at: string;
}

export interface TypingPayload {
  conversationId: string;
  participantId: string;
  participantType: ParticipantType;
}

export interface MessageReadPayload {
  conversationId: string;
  lastReadSequence: number;
  readerType: ParticipantType;
  at: string;
}

export interface ConversationUpdatedPayload {
  conversationId: string;
  status: ConversationStatus;
  assigneeId: string | null;
  lastMessageAt: string;
}

export interface ConversationSyncPayload {
  conversationId: string;
  afterSequence: number;
  messages: MessageNewPayload[];
  lastSequence: number;
  /** More than REALTIME.syncMessageCap were missing — refetch over HTTP instead. */
  truncated: boolean;
}

export interface SummaryUpdatedPayload {
  conversationId: string;
  state: 'QUEUED' | 'READY' | 'STALE' | 'ERROR';
  updatedAt: string;
}

/** Event-name constants, so a typo is a compile error rather than a silent no-op. */
export const SOCKET_EVENTS = {
  conversationSubscribe: 'conversation:subscribe',
  conversationSubscribed: 'conversation:subscribed',
  conversationSync: 'conversation:sync',
  conversationUpdated: 'conversation:updated',
  messageSend: 'message:send',
  messageAccepted: 'message:accepted',
  messageNew: 'message:new',
  messageFailed: 'message:failed',
  messageRead: 'message:read',
  typingStart: 'typing:start',
  typingStop: 'typing:stop',
  presenceUpdate: 'presence:update',
  summaryUpdated: 'summary:updated',
} as const;

export interface ServerToClientEvents {
  'conversation:subscribed': (p: ConversationSubscribedPayload) => void;
  'conversation:sync': (p: ConversationSyncPayload) => void;
  'conversation:updated': (p: ConversationUpdatedPayload) => void;
  'message:accepted': (p: MessageAcceptedPayload) => void;
  'message:new': (p: MessageNewPayload) => void;
  'message:failed': (p: MessageFailedPayload) => void;
  'message:read': (p: MessageReadPayload) => void;
  'typing:start': (p: TypingPayload) => void;
  'typing:stop': (p: TypingPayload) => void;
  'presence:update': (p: PresenceUpdatePayload) => void;
  'summary:updated': (p: SummaryUpdatedPayload) => void;
}

export type Ack<T> = (result: { ok: true; data: T } | { ok: false; code: ErrorCode; message: string }) => void;

export interface ClientToServerEvents {
  'conversation:subscribe': (p: unknown, ack?: Ack<ConversationSubscribedPayload>) => void;
  'message:send': (p: unknown, ack?: Ack<MessageAcceptedPayload>) => void;
  'message:read': (p: unknown, ack?: Ack<{ lastReadSequence: number }>) => void;
  'typing:start': (p: unknown) => void;
  'typing:stop': (p: unknown) => void;
}

/** Room names. Both carry the workspace id so a room cannot be shared across tenants. */
export function workspaceRoom(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function conversationRoom(workspaceId: string, conversationId: string): string {
  return `conversation:${workspaceId}:${conversationId}`;
}
