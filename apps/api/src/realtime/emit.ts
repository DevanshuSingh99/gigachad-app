import { conversationRoom, workspaceRoom } from '@gigachad/shared';
import type {
  ConversationUpdatedPayload,
  MessageNewPayload,
  MessageReadPayload,
  MessageUpdatedPayload,
  SummaryUpdatedPayload,
} from '@gigachad/shared';

import type { IoServer } from './types';

/**
 * A module-level reference to the attached Socket.IO server, set once at boot
 * (server.ts, right after attachSocketServer).
 *
 * This exists so "persist, then emit" (invariant 2) is a property of the WRITE
 * PATH — messages/service.ts's createMessage — rather than of whichever
 * transport happened to call it. Before this, the broadcast lived only inside
 * the socket's message:send handler, which meant a message sent over REST (the
 * dashboard composer's actual path) persisted correctly but never told anyone
 * else it existed. Moving the emit into the service closes that gap for every
 * current and future caller — REST, socket, and Phase E's email ingestion alike
 * — with nothing for any of them to remember.
 */
let ioRef: IoServer | null = null;

export function setIoServer(io: IoServer): void {
  ioRef = io;
}

export function emitMessageNew(workspaceId: string, conversationId: string, payload: MessageNewPayload): void {
  ioRef?.to(conversationRoom(workspaceId, conversationId)).emit('message:new', payload);
}

/**
 * Emitted when an existing message's delivery status changes after creation —
 * e.g. an outbound email's webhook-driven PENDING → SENT/DELIVERED/FAILED/
 * BOUNCED transition (modules/email/service.ts, modules/email/jobs/emailSendJob.ts).
 * Same room as `message:new` so a client already subscribed to the
 * conversation picks it up without a separate join.
 */
export function emitMessageUpdated(
  workspaceId: string,
  conversationId: string,
  payload: MessageUpdatedPayload,
): void {
  ioRef?.to(conversationRoom(workspaceId, conversationId)).emit('message:updated', payload);
}

export function emitConversationUpdated(workspaceId: string, payload: ConversationUpdatedPayload): void {
  ioRef?.to(workspaceRoom(workspaceId)).emit('conversation:updated', payload);
}

export function emitMessageRead(workspaceId: string, conversationId: string, payload: MessageReadPayload): void {
  ioRef?.to(conversationRoom(workspaceId, conversationId)).emit('message:read', payload);
}

export function emitSummaryUpdated(
  workspaceId: string,
  conversationId: string,
  payload: SummaryUpdatedPayload,
): void {
  ioRef?.to(conversationRoom(workspaceId, conversationId)).emit('summary:updated', payload);
}
