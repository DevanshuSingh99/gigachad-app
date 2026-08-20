import crypto from 'node:crypto';

import type { EmailReplyInput, MessageDto } from '@gigachad/shared';

import { db } from '../../db';
import { env, supportAddressFor } from '../../env';
import { AppError, notFound } from '../../lib/errors';
import { isUniqueViolationOn } from '../../lib/prismaErrors';
import { emailSendQueue } from '../../lib/email/queue';
import {
  brevoProvider,
  isWebhookTimestampFresh,
  type BrevoInboundPayload,
} from '../../lib/email/provider';
import { sanitizeChatMessageHtml } from '../../lib/sanitize';
import { logger } from '../../lib/logger';
import type { WorkspaceScope } from '../../lib/repo';
import { allocateSequenceAndMaybeReopen, type AllocatedSequence } from '../conversations/repo';
import { messageDto } from '../messages/dto';
import { findByClientMessageId, insertMessage } from '../messages/repo';
import { emitConversationUpdated, emitMessageNew, emitMessageUpdated } from '../../realtime/emit';
import type { IngestResult } from './dto';
import * as repo from './repo';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalizes an email address to lowercase trimmed form. */
function normalizeEmail(address: string): string {
  return address.toLowerCase().trim();
}

/** Strips angle brackets from an RFC Message-ID if present. */
function normalizeMessageId(raw: string): string {
  return raw.trim().replace(/^<|>$/g, '');
}

/**
 * Parses a space-separated RFC References header into an array of Message-IDs.
 * Each entry has angle brackets stripped and is deduplicated.
 */
function parseReferences(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of raw.split(/\s+/)) {
    const id = normalizeMessageId(token);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Generates an RFC-compliant Message-ID for outbound emails.
 * Format: `<timestamp.random@domain>`.
 */
export function generateMessageId(domain: string): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(8).toString('hex');
  return `<${ts}.${rand}@${domain}>`;
}

// ─── Inbound ingestion ────────────────────────────────────────────────────────

/**
 * The entire inbound email ingestion pipeline, called from the webhook route.
 *
 * Pipeline order (must match docs/07-email.md and docs/18-execution.md):
 *  1. Signature verification, then payload parsing, then timestamp-tolerance
 *     check — all before any persistence (dedup included).
 *  2. Dedup on provider event ID.
 *  3. Resolve workspace from recipient local part.
 *  4. Unroutable → 2xx + warn (handled by returning null).
 *  5. Normalize sender, parse text/plain as canonical, sanitize HTML.
 *  6. Thread match: In-Reply-To → References → provider thread ID → (no match).
 *  7. No match: find-or-create contact, create EMAIL conversation.
 *  8. One transaction: allocate sequence → insert message → insert email_message
 *     → upsert email_thread.
 *  9. Emit socket events. Caller returns 2xx.
 *
 * Returns null when the recipient is unroutable (caller logs + returns 2xx).
 */
export async function ingestInboundEmail(
  rawBody: Buffer,
  signature: string,
): Promise<IngestResult | null> {
  // ── 1a. Signature verification (fail closed — see env.ts, lib/email/provider.ts) ──
  if (env.emailWebhookVerificationEnabled) {
    const valid = brevoProvider.verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  let parsed: BrevoInboundPayload;
  try {
    const body = JSON.parse(rawBody.toString('utf8')) as unknown;
    parsed = brevoProvider.parseInboundPayload(body);
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Malformed inbound webhook payload.',
      cause: err,
    });
  }

  // ── 1b. Timestamp tolerance — rejects a stale/replayed payload before any
  // persistence, including the dedup check below. Gated by the same flag as
  // the signature check above: when email verification is off (email feature
  // entirely unconfigured), there is no trusted clock to check freshness
  // against either. Same error code as a bad signature
  // (WEBHOOK_SIGNATURE_INVALID covers "bad signature OR stale timestamp" per
  // docs/16-errors-and-limits.md), and the same fail-closed rule applies to a
  // missing/unparseable SentAtDate.
  if (env.emailWebhookVerificationEnabled) {
    const sentAtMs = parsed.SentAtDate ? Date.parse(parsed.SentAtDate) : NaN;
    if (!isWebhookTimestampFresh(sentAtMs)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }
  }

  const providerEventId: string = parsed.Uuid[0] ?? crypto.randomUUID();

  // ── 2. Dedup on provider event ID BEFORE workspace resolution ────────────
  const alreadySeen = await repo.findIdempotencyKey(providerEventId);
  if (alreadySeen) {
    logger.info({ providerEventId }, 'inbound email: duplicate event, skipping');
    return null;
  }

  // ── 3. Resolve workspace from recipient local part ────────────────────────
  const recipientAddress = (parsed.To[0]?.Address ?? '').toLowerCase().trim();
  const atIndex = recipientAddress.indexOf('@');
  const localPart = atIndex >= 0 ? recipientAddress.slice(0, atIndex) : recipientAddress;
  const workspace = await repo.findWorkspaceBySlug(localPart);

  // ── 4. Unroutable recipient: ack with 2xx, never error ───────────────────
  if (!workspace) {
    logger.warn(
      { recipient: recipientAddress, providerEventId },
      'inbound email: unroutable recipient — acknowledged without persisting',
    );
    // Record idempotency key with null workspaceId so this replay is recognized.
    await db.idempotencyKey.create({
      data: {
        actorScope: 'provider',
        key: providerEventId,
        requestHash: providerEventId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return null;
  }

  const scope: WorkspaceScope = { workspaceId: workspace.id };

  // ── 5. Normalize content ──────────────────────────────────────────────────
  const fromEmail = normalizeEmail(parsed.From.Address);
  const fromName = parsed.From.Name || null;
  const incomingMessageId = normalizeMessageId(parsed.MessageId);
  const inReplyTo = parsed.InReplyTo
    ? normalizeMessageId(parsed.InReplyTo)
    : undefined;
  const references = parseReferences(parsed.Headers?.References ?? parsed.InReplyTo);
  const bodyText = parsed.Text ?? '';
  const bodyHtml = parsed.Html ? sanitizeChatMessageHtml(parsed.Html) : null;
  const subject = parsed.Subject ?? '(No Subject)';
  const mailboxAddress = supportAddressFor(workspace.slug);
  // Third-tier thread token: Brevo has no dedicated "conversation id" field on
  // the inbound payload, but some clients (notably Outlook) keep a stable
  // `Thread-Index` header across a reply chain even when In-Reply-To/References
  // get stripped in transit. Deliberately NOT `Thread-Topic` — that is just the
  // subject line, and docs/07-email.md forbids merging threads solely by subject.
  const providerThreadId = parsed.Headers?.['Thread-Index']?.trim() || undefined;

  // ── 6. Thread matching: In-Reply-To → References → provider thread ID ────
  let conversationId: string | null = null;
  let isNewConversation = false;

  if (inReplyTo) {
    const hit = await db.$transaction(async (tx) => {
      return repo.findConversationByMessageId(tx, scope, inReplyTo);
    });
    if (hit?.message?.conversationId) {
      conversationId = hit.message.conversationId;
    }
  }

  if (!conversationId && references.length > 0) {
    const hit = await db.$transaction(async (tx) => {
      return repo.findConversationByReferences(tx, scope, references);
    });
    if (hit) conversationId = hit.conversationId;
  }

  if (!conversationId && providerThreadId) {
    const hit = await db.$transaction(async (tx) => {
      return repo.findConversationByProviderThreadId(tx, scope, providerThreadId);
    });
    if (hit) conversationId = hit.conversationId;
  }

  // ── 7+8. Persist in one transaction ──────────────────────────────────────
  const result = await db.$transaction(async (tx) => {
    // Register idempotency key inside the transaction so a rollback retries.
    await repo.insertIdempotencyKey(tx, providerEventId, workspace.id);

    let createdConversation = false;
    let resolvedConversationId: string;

    if (conversationId) {
      resolvedConversationId = conversationId;
    } else {
      // No thread match — find or create contact and create a new EMAIL conversation.
      const contact = await repo.findOrCreateContactByEmail(tx, scope, fromEmail, fromName);

      const conversation = await tx.conversation.create({
        data: {
          workspaceId: workspace.id,
          contactId: contact.id,
          channel: 'EMAIL',
          subject,
        },
        select: { id: true },
      });
      resolvedConversationId = conversation.id;
      createdConversation = true;
    }

    // Allocate sequence and maybe reopen SNOOZED/RESOLVED (inbound is CUSTOMER).
    const allocation = await allocateSequenceAndMaybeReopen(
      tx,
      scope,
      resolvedConversationId,
      'CUSTOMER',
    );
    if (!allocation) throw notFound('conversation');

    // Insert the inbox message.
    const message = await insertMessage(tx, {
      workspaceId: workspace.id,
      conversationId: resolvedConversationId,
      senderType: 'CUSTOMER',
      bodyText,
      ...(bodyHtml ? { bodyHtml } : {}),
      clientMessageId: providerEventId,
      sequence: allocation.sequence,
    });

    // Insert transport metadata.
    await repo.insertEmailMessage(tx, {
      workspaceId: workspace.id,
      gigachadMessageId: message.id,
      messageId: incomingMessageId,
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references.length > 0 ? { referencesJson: references } : {}),
      fromAddress: fromEmail,
      toAddresses: [recipientAddress],
      providerEventId,
      direction: 'INBOUND',
      deliveryStatus: 'DELIVERED',
      receivedAt: new Date(),
    });

    // Upsert the thread (creates it for a new conversation; updates for an existing one).
    const existingThread = await repo.findEmailThread(tx, scope, resolvedConversationId);
    const prevRefs = Array.isArray(existingThread?.referencesJson)
      ? (existingThread.referencesJson as string[])
      : [];

    await repo.upsertEmailThread(tx, scope, {
      conversationId: resolvedConversationId,
      mailboxAddress,
      newMessageId: incomingMessageId,
      ...(providerThreadId ? { providerThreadId } : {}),
      prevReferences: prevRefs,
    });

    return {
      conversationId: resolvedConversationId,
      message: messageDto(message),
      allocation,
      isNewConversation: createdConversation,
    };
  });

  // ── 9. Emit socket events (invariant 2: persist then emit) ───────────────
  emitMessageNew(workspace.id, result.conversationId, {
    messageId: result.message.id,
    conversationId: result.conversationId,
    sequence: result.message.sequence,
    senderType: result.message.senderType,
    bodyText: result.message.bodyText,
    ...(result.message.bodyHtml ? { bodyHtml: result.message.bodyHtml } : {}),
    createdAt: result.message.createdAt,
  });

  emitConversationUpdated(workspace.id, {
    conversationId: result.conversationId,
    status: result.allocation.status,
    assigneeId: result.allocation.assigneeId,
    lastMessageAt: result.allocation.lastMessageAt.toISOString(),
  });

  return {
    conversationId: result.conversationId,
    message: result.message,
    isNewConversation: result.isNewConversation,
  };
}

// ─── Delivery status update ───────────────────────────────────────────────────

/**
 * Handles a Brevo delivery-status event webhook.
 * Updates the EmailMessage's deliveryStatus by provider event ID.
 * Always returns normally — unrecognized events are silently discarded.
 */
export async function handleDeliveryEvent(rawBody: Buffer, signature: string): Promise<void> {
  if (env.emailWebhookVerificationEnabled) {
    const valid = brevoProvider.verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_FAILED', { message: 'Malformed event webhook payload.' });
  }

  const payload = brevoProvider.parseEventPayload(body);

  // Timestamp tolerance — same rule and same gating as ingestInboundEmail's
  // (see there for why: fail closed, before any persistence). Brevo's event
  // payload carries `ts` as epoch seconds, not an ISO string.
  if (env.emailWebhookVerificationEnabled) {
    const sentAtMs = typeof payload.ts === 'number' ? payload.ts * 1000 : NaN;
    if (!isWebhookTimestampFresh(sentAtMs)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }
  }

  const providerEventId = payload['message-id'];
  if (!providerEventId) return;

  // Map the event string to our DeliveryStatus enum.
  const statusMap: Record<string, string> = {
    delivered: 'DELIVERED',
    soft_bounce: 'FAILED',
    hard_bounce: 'BOUNCED',
    invalid_email: 'BOUNCED',
    deferred: 'PENDING',
    blocked: 'FAILED',
    spam: 'FAILED',
    sent: 'SENT',
  };
  const deliveryStatus = statusMap[payload.event];
  if (!deliveryStatus) return;

  // Persists to both email_messages AND messages (see repo.ts for why the
  // dashboard needs the latter), then emits so the dashboard updates live
  // instead of showing a stale status until the next manual refresh.
  const sync = await repo.updateDeliveryStatusByProviderEventId(
    providerEventId,
    deliveryStatus as Parameters<typeof repo.updateDeliveryStatusByProviderEventId>[1],
  );
  if (sync) {
    emitMessageUpdated(sync.workspaceId, sync.conversationId, {
      messageId: sync.messageId,
      conversationId: sync.conversationId,
      deliveryStatus: sync.deliveryStatus,
    });
  }
}

// ─── Outbound email reply ─────────────────────────────────────────────────────

/**
 * Creates an outbound email reply from a dashboard agent.
 *
 * Steps:
 *  0. Idempotency pre-check by clientMessageId (same two-layer pattern as
 *     messages/service.ts#createMessage — see there for the full reasoning).
 *  1. Verify the conversation is EMAIL channel.
 *  2. Load thread metadata for reply headers.
 *  3. One transaction: allocate sequence → insert message → insert email_message → update thread.
 *  4. Enqueue a BullMQ job for the worker to send.
 *  5. Emit socket events.
 *  6. Return the created inbox message DTO.
 */
export async function createEmailReply(
  scope: WorkspaceScope,
  conversationId: string,
  input: EmailReplyInput,
  agentUserId: string,
): Promise<MessageDto> {
  // ── 0. Idempotency pre-check — the common case: a client retries after a
  // timeout or a dropped response, and this finds the already-committed
  // message without touching the sequence counter or re-enqueuing a send.
  const existing = await findByClientMessageId(db, scope, conversationId, input.clientMessageId);
  if (existing) return messageDto(existing);

  // ── 1. Verify conversation is EMAIL channel ───────────────────────────────
  const conversation = await repo.findConversationChannel(scope, conversationId);
  if (!conversation) throw notFound('conversation');
  if (conversation.channel !== 'EMAIL') {
    throw new AppError('VALIDATION_FAILED', {
      message: 'email-reply is only valid for EMAIL conversations.',
    });
  }

  // ── 2. Load thread metadata ───────────────────────────────────────────────
  const thread = await repo.findEmailThreadForConversation(scope, conversationId);
  if (!thread) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'No email thread found for this conversation.',
    });
  }

  const replyTo = thread.mailboxAddress;
  const contactEmail = thread.conversation.contact.email;
  if (!contactEmail) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Contact has no email address to reply to.',
    });
  }

  const outboundMessageId = generateMessageId(env.INBOUND_EMAIL_DOMAIN ?? 'gigachad.app');
  const inReplyTo = thread.lastMessageId ?? undefined;
  const prevRefs = Array.isArray(thread.referencesJson)
    ? (thread.referencesJson as string[])
    : [];

  const bodyHtml = input.bodyHtml ? sanitizeChatMessageHtml(input.bodyHtml) : undefined;

  // ── 3. Persist in one transaction ─────────────────────────────────────────
  let result: { message: MessageDto; emailMessageId: string; allocation: AllocatedSequence };
  try {
    result = await db.$transaction(async (tx) => {
      const allocation = await allocateSequenceAndMaybeReopen(tx, scope, conversationId, 'AGENT');
      if (!allocation) throw notFound('conversation');

      const message = await insertMessage(tx, {
        workspaceId: scope.workspaceId,
        conversationId,
        senderType: 'AGENT',
        senderUserId: agentUserId,
        bodyText: input.bodyText,
        ...(bodyHtml ? { bodyHtml } : {}),
        clientMessageId: input.clientMessageId,
        sequence: allocation.sequence,
      });

      const emailMsg = await repo.insertEmailMessage(tx, {
        workspaceId: scope.workspaceId,
        gigachadMessageId: message.id,
        messageId: normalizeMessageId(outboundMessageId),
        ...(inReplyTo ? { inReplyTo } : {}),
        ...(prevRefs.length > 0 ? { referencesJson: prevRefs } : {}),
        fromAddress: env.mailFrom ?? replyTo,
        toAddresses: [contactEmail],
        direction: 'OUTBOUND',
        deliveryStatus: 'PENDING',
      });

      await repo.upsertEmailThread(tx, scope, {
        conversationId,
        mailboxAddress: replyTo,
        newMessageId: normalizeMessageId(outboundMessageId),
        ...(thread.providerThreadId ? { providerThreadId: thread.providerThreadId } : {}),
        prevReferences: prevRefs,
      });

      return { message: messageDto(message), emailMessageId: emailMsg.id, allocation };
    });
  } catch (error) {
    // The rare case: two requests with the same clientMessageId race past the
    // pre-check above. The loser's INSERT hits the unique constraint on
    // (conversationId, clientMessageId) and rolls back its whole transaction
    // (sequence allocation included) — return the winner instead of a
    // Prisma error the global error middleware would otherwise map to a
    // nonsensical SLUG_TAKEN (see messages/service.ts#createMessage).
    if (isUniqueViolationOn(error, 'clientMessageId')) {
      const winner = await findByClientMessageId(db, scope, conversationId, input.clientMessageId);
      if (winner) return messageDto(winner);
    }
    throw error;
  }

  // ── 4. Enqueue send job (after commit — invariant 2) ──────────────────────
  await emailSendQueue.add(
    'send',
    {
      emailMessageId: result.emailMessageId,
      gigachadMessageId: result.message.id,
      workspaceId: scope.workspaceId,
      conversationId,
    },
    { jobId: `email-${result.message.id}` },
  );

  // ── 5. Emit socket events ──────────────────────────────────────────────────
  emitMessageNew(scope.workspaceId, conversationId, {
    messageId: result.message.id,
    conversationId,
    sequence: result.message.sequence,
    senderType: result.message.senderType,
    bodyText: result.message.bodyText,
    ...(result.message.bodyHtml ? { bodyHtml: result.message.bodyHtml } : {}),
    createdAt: result.message.createdAt,
  });

  emitConversationUpdated(scope.workspaceId, {
    conversationId,
    status: result.allocation.status,
    assigneeId: result.allocation.assigneeId,
    lastMessageAt: result.allocation.lastMessageAt.toISOString(),
  });

  return result.message;
}
