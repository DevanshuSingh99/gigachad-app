import type { DeliveryStatus } from '@gigachad/shared';

import { db, type Tx, unscoped } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

// ─── Idempotency / deduplication ──────────────────────────────────────────────

/**
 * Checks whether a provider event ID has already been processed.
 *
 * IdempotencyKey has no workspaceId guard (nullable by design — see db.ts),
 * so this uses the raw db client directly, not unscoped().
 */
export async function findIdempotencyKey(
  providerEventId: string,
): Promise<boolean> {
  const row = await db.idempotencyKey.findFirst({
    where: { actorScope: 'provider', key: providerEventId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Records a provider event ID as processed.
 *
 * Called inside the ingest transaction so if the transaction rolls back,
 * the key is not persisted and the webhook will be retried.
 *
 * workspaceId is nullable (may be null when the recipient is unroutable
 * and we never resolved the workspace).
 */
export function insertIdempotencyKey(
  client: Tx,
  providerEventId: string,
  workspaceId: string | null,
): Promise<unknown> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return client.idempotencyKey.create({
    data: {
      actorScope: 'provider',
      key: providerEventId,
      requestHash: providerEventId,
      ...(workspaceId ? { workspaceId } : {}),
      expiresAt,
    },
  });
}

// ─── Workspace resolution ──────────────────────────────────────────────────────

/**
 * Resolves a workspace by slug (the local part of the inbound email address).
 *
 * Cross-tenant by definition — we don't know the workspace yet.
 */
export function findWorkspaceBySlug(slug: string) {
  return unscoped('resolve workspace from inbound email recipient local part', () =>
    db.workspace.findFirst({
      where: { slug },
      select: { id: true, slug: true, name: true, settingsJson: true },
    }),
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────

/**
 * Finds an existing contact by normalized email, or creates one.
 *
 * `contacts_workspace_email_key` (prisma/migrations/.../migration.sql) is a
 * partial unique index on `(workspace_id, email) WHERE email IS NOT NULL` —
 * hand-written because Prisma has no partial-index syntax, so it isn't a
 * `@@unique` in schema.prisma and Prisma's typed `upsert()` can't target it.
 * This is raw SQL for exactly that reason: it's a real atomic
 * `INSERT ... ON CONFLICT DO UPDATE` against that index, not a find-then-create
 * — two concurrent inbounds for the same brand-new sender resolve to one
 * Contact row instead of racing into a duplicate (or, since the index already
 * existed, into an unhandled unique-violation error).
 */
export async function findOrCreateContactByEmail(
  client: Tx,
  scope: WorkspaceScope,
  email: string,
  name: string | null,
): Promise<{ id: string }> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO contacts (id, workspace_id, email, name, identity_source, created_at, updated_at, last_seen_at)
    VALUES (gen_random_uuid(), ${scope.workspaceId}::uuid, ${email}, ${name}, 'EMAIL', now(), now(), now())
    ON CONFLICT (workspace_id, email) WHERE email IS NOT NULL
      DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `;
  return rows[0]!;
}

// ─── Thread matching ───────────────────────────────────────────────────────────

/**
 * Finds the conversation that owns a given RFC Message-ID.
 *
 * Checks `email_messages.message_id`, which stores the RFC Message-ID of each
 * stored message. The lookup is scoped to the workspace (invariant 1).
 */
export function findConversationByMessageId(
  client: Tx,
  scope: WorkspaceScope,
  messageId: string,
) {
  return client.emailMessage.findFirst({
    where: { workspaceId: scope.workspaceId, messageId },
    select: { gigachadMessageId: true, message: { select: { conversationId: true } } },
  });
}

/**
 * Finds a conversation by matching any of the `References` Message-IDs.
 * Tries each one in order, returning the first match. Scoped to workspace.
 */
export async function findConversationByReferences(
  client: Tx,
  scope: WorkspaceScope,
  references: string[],
): Promise<{ conversationId: string } | null> {
  for (const ref of references) {
    const row = await client.emailMessage.findFirst({
      where: { workspaceId: scope.workspaceId, messageId: ref },
      select: { message: { select: { conversationId: true } } },
    });
    if (row?.message?.conversationId) {
      return { conversationId: row.message.conversationId };
    }
  }
  return null;
}

/**
 * Third-tier thread match, tried only when `In-Reply-To` and `References` both
 * miss (e.g. a client stripped standard threading headers). Matches on
 * `email_threads.provider_thread_id`, scoped to the workspace like every other
 * thread lookup (docs/07-email.md invariant: a match is valid only within the
 * resolved workspace).
 */
export function findConversationByProviderThreadId(
  client: Tx,
  scope: WorkspaceScope,
  providerThreadId: string,
): Promise<{ conversationId: string } | null> {
  return client.emailThread.findFirst({
    where: { workspaceId: scope.workspaceId, providerThreadId },
    select: { conversationId: true },
  });
}

// ─── Email thread ──────────────────────────────────────────────────────────────

export interface EmailThreadRow {
  id: string;
  workspaceId: string;
  conversationId: string;
  lastMessageId: string | null;
  referencesJson: unknown;
}

export function findEmailThread(
  client: Tx,
  scope: WorkspaceScope,
  conversationId: string,
): Promise<EmailThreadRow | null> {
  return client.emailThread.findFirst({
    where: { workspaceId: scope.workspaceId, conversationId },
    select: {
      id: true,
      workspaceId: true,
      conversationId: true,
      lastMessageId: true,
      referencesJson: true,
    },
  });
}

/**
 * Bounded RFC References chain: keep the first message ID plus the most recent 8.
 * Empty input starts a new chain at `newMessageId`.
 */
export function boundReferenceChain(prevRefs: string[], newMessageId: string): string[] {
  if (prevRefs.length === 0 || !prevRefs[0]) return [newMessageId];
  const first = prevRefs[0];
  const combined = [...prevRefs.slice(1), newMessageId];
  return [first, ...combined.slice(-8)];
}

/**
 * Upserts an EmailThread row, updating `lastMessageId` and the bounded
 * `referencesJson` chain (first + last 8).
 */
export function upsertEmailThread(
  client: Tx,
  scope: WorkspaceScope,
  data: {
    conversationId: string;
    mailboxAddress: string;
    newMessageId: string;
    providerThreadId?: string;
    prevReferences: string[];
  },
): Promise<{ id: string }> {
  const newRefs = boundReferenceChain(data.prevReferences, data.newMessageId);

  return client.emailThread.upsert({
    where: {
      workspaceId_conversationId: {
        workspaceId: scope.workspaceId,
        conversationId: data.conversationId,
      },
    },
    create: {
      workspaceId: scope.workspaceId,
      conversationId: data.conversationId,
      mailboxAddress: data.mailboxAddress,
      lastMessageId: data.newMessageId,
      referencesJson: newRefs,
      ...(data.providerThreadId ? { providerThreadId: data.providerThreadId } : {}),
    },
    update: {
      lastMessageId: data.newMessageId,
      referencesJson: newRefs,
      // Also persisted on update, not just create: a thread created before a
      // provider thread id was ever seen (e.g. the first message lacked the
      // header) can still pick one up from a later message in the same thread.
      ...(data.providerThreadId ? { providerThreadId: data.providerThreadId } : {}),
    },
    select: { id: true },
  });
}

// ─── Email message ─────────────────────────────────────────────────────────────

export interface EmailMessageInsertData {
  workspaceId: string;
  gigachadMessageId: string;
  messageId: string;
  inReplyTo?: string;
  referencesJson?: unknown;
  fromAddress: string;
  toAddresses: string[];
  providerEventId?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  deliveryStatus: DeliveryStatus;
  receivedAt?: Date;
  sentAt?: Date;
}

export function insertEmailMessage(
  client: Tx,
  data: EmailMessageInsertData,
) {
  return client.emailMessage.create({
    data: {
      workspaceId: data.workspaceId,
      gigachadMessageId: data.gigachadMessageId,
      messageId: data.messageId,
      ...(data.inReplyTo ? { inReplyTo: data.inReplyTo } : {}),
      ...(data.referencesJson ? { referencesJson: data.referencesJson } : {}),
      fromAddress: data.fromAddress,
      toAddressesJson: data.toAddresses,
      ...(data.providerEventId ? { providerEventId: data.providerEventId } : {}),
      direction: data.direction,
      deliveryStatus: data.deliveryStatus,
      ...(data.receivedAt ? { receivedAt: data.receivedAt } : {}),
      ...(data.sentAt ? { sentAt: data.sentAt } : {}),
    },
    select: { id: true },
  });
}

/** Ids needed to broadcast a delivery-status change after it is persisted. */
export interface DeliveryStatusSyncResult {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  deliveryStatus: DeliveryStatus;
}

/**
 * Updates delivery status of an email by provider event ID, and mirrors the
 * same status onto the linked inbox message (`messages.delivery_status`) in
 * the same operation.
 *
 * `email_messages.delivery_status` is the row a webhook actually writes, but
 * `messages.delivery_status` is what the dashboard's `MessageDto` reads
 * (messages/repo.ts). Without this sync the two never agree and the dashboard
 * keeps showing whatever `messages.delivery_status` defaulted to at insert
 * time. Returns null when the event id is unknown or the EmailMessage has no
 * linked inbox message (never expected in practice, but the link is nullable
 * in the schema).
 */
export async function updateDeliveryStatusByProviderEventId(
  providerEventId: string,
  deliveryStatus: DeliveryStatus,
): Promise<DeliveryStatusSyncResult | null> {
  return unscoped('update delivery status from provider event webhook', async () => {
    const emailMsg = await db.emailMessage.findFirst({
      where: { providerEventId },
      select: { workspaceId: true, gigachadMessageId: true },
    });
    if (!emailMsg?.gigachadMessageId) return null;

    const [, message] = await db.$transaction([
      db.emailMessage.updateMany({ where: { providerEventId }, data: { deliveryStatus } }),
      db.message.update({
        where: { id: emailMsg.gigachadMessageId },
        data: { deliveryStatus },
        select: { conversationId: true },
      }),
    ]);

    return {
      workspaceId: emailMsg.workspaceId,
      conversationId: message.conversationId,
      messageId: emailMsg.gigachadMessageId,
      deliveryStatus,
    };
  });
}

/**
 * Mirrors a delivery-status change onto the linked inbox message. Used by the
 * outbound send worker (modules/email/jobs/emailSendJob.ts), which already
 * knows `gigachadMessageId` from its job data rather than needing to look it
 * up by provider event id the way the webhook handler above does.
 *
 * Callers are responsible for running this inside `unscoped(...)` — `Message`
 * is a tenant-scoped model and this deliberately omits `workspaceId` from the
 * predicate the same way `updateDeliveryStatusByProviderEventId` does above.
 */
export function syncMessageDeliveryStatus(
  client: Tx,
  gigachadMessageId: string,
  deliveryStatus: DeliveryStatus,
) {
  return client.message.update({
    where: { id: gigachadMessageId },
    data: { deliveryStatus },
    select: { id: true },
  });
}

/**
 * Finds an EmailMessage by the gigachadMessageId (i.e. the linked inbox message)
 * to retrieve thread data needed for outbound send.
 */
export function findEmailMessageByGigachadId(
  scope: WorkspaceScope,
  gigachadMessageId: string,
) {
  return db.emailMessage.findFirst({
    where: { workspaceId: scope.workspaceId, gigachadMessageId },
    select: {
      id: true,
      messageId: true,
      direction: true,
      deliveryStatus: true,
      fromAddress: true,
      toAddressesJson: true,
      sentAt: true,
    },
  });
}

// ─── Conversation / email thread data for outbound ────────────────────────────

/**
 * Loads the email thread + conversation subject and contact email for composing
 * an outbound reply.
 */
export function findEmailThreadForConversation(
  scope: WorkspaceScope,
  conversationId: string,
) {
  return db.emailThread.findFirst({
    where: { workspaceId: scope.workspaceId, conversationId },
    select: {
      mailboxAddress: true,
      lastMessageId: true,
      referencesJson: true,
      providerThreadId: true,
      conversation: {
        select: {
          subject: true,
          contact: { select: { email: true, name: true } },
        },
      },
    },
  });
}

/** Finds a conversation channel — used to reject non-EMAIL conversations from email-reply. */
export function findConversationChannel(
  scope: WorkspaceScope,
  conversationId: string,
) {
  return db.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: { channel: true, status: true },
  });
}
