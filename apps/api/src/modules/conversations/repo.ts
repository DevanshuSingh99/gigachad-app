import type { AssigneeFilter, Channel, ConversationStatus } from '@gigachad/shared';

import { db, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

const CONVERSATION_SELECT = {
  id: true,
  channel: true,
  status: true,
  subject: true,
  assigneeId: true,
  assignee: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true, email: true } },
  snoozedUntil: true,
  lastMessageAt: true,
  messageCount: true,
  agentLastReadSequence: true,
  customerLastReadSequence: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ConversationFilters {
  channel?: Channel;
  status?: ConversationStatus;
  assigneeId?: AssigneeFilter;
}

function assigneeWhere(filter: AssigneeFilter | undefined) {
  if (filter === undefined) return {};
  return filter === 'unassigned' ? { assigneeId: null } : { assigneeId: filter };
}

export function listConversations(
  scope: WorkspaceScope,
  filters: ConversationFilters,
  opts: { take: number; before?: { lastMessageAt: Date; id: string } },
) {
  return db.conversation.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...assigneeWhere(filters.assigneeId),
      ...(opts.before
        ? {
            OR: [
              { lastMessageAt: { lt: opts.before.lastMessageAt } },
              { lastMessageAt: opts.before.lastMessageAt, id: { lt: opts.before.id } },
            ],
          }
        : {}),
    },
    select: CONVERSATION_SELECT,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: opts.take,
  });
}

export function findConversation(scope: WorkspaceScope, conversationId: string) {
  return db.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: CONVERSATION_SELECT,
  });
}

/** Minimal projection for validating a patch against the conversation's current state. */
export function findConversationState(client: Tx, scope: WorkspaceScope, conversationId: string) {
  return client.conversation.findFirst({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    select: { id: true, status: true, assigneeId: true, snoozedUntil: true },
  });
}

export function findContactForConversation(scope: WorkspaceScope, contactId: string) {
  return db.contact.findFirst({
    where: { id: contactId, workspaceId: scope.workspaceId },
    select: { id: true },
  });
}

export function createConversation(data: {
  workspaceId: string;
  contactId: string;
  channel: Channel;
  subject?: string;
}) {
  return db.conversation.create({
    data,
    select: CONVERSATION_SELECT,
  });
}

/** True if `userId` is an active member of the workspace — used to validate an assignee. */
export async function isActiveMember(
  client: Tx,
  scope: WorkspaceScope,
  userId: string,
): Promise<boolean> {
  const member = await client.workspaceMember.findFirst({
    where: { workspaceId: scope.workspaceId, userId, status: 'ACTIVE' },
    select: { id: true },
  });
  return member !== null;
}

export function updateConversationFields(
  client: Tx,
  scope: WorkspaceScope,
  conversationId: string,
  data: {
    status?: ConversationStatus;
    assigneeId?: string | null;
    snoozedUntil?: Date | null;
  },
) {
  return client.conversation.update({
    where: { id: conversationId, workspaceId: scope.workspaceId },
    data,
    select: CONVERSATION_SELECT,
  });
}

/** Closes whichever assignment is currently open, if any — a conversation has at most one. */
export function endCurrentAssignment(client: Tx, scope: WorkspaceScope, conversationId: string) {
  return client.conversationAssignment.updateMany({
    where: { workspaceId: scope.workspaceId, conversationId, endedAt: null },
    data: { endedAt: new Date() },
  });
}

export function insertAssignment(
  client: Tx,
  scope: WorkspaceScope,
  data: { conversationId: string; assigneeId: string; assignedBy: string },
) {
  return client.conversationAssignment.create({
    data: { workspaceId: scope.workspaceId, ...data },
  });
}

/**
 * Allocates the next sequence for a message and, if it's from the customer,
 * atomically reopens a SNOOZED or RESOLVED conversation — one locking UPDATE
 * covers both, so there is no second write and no second lock acquisition
 * (docs/04-database.md invariant 3).
 *
 * $queryRaw bypasses the tenant-scope guard in src/db.ts (the guard intercepts
 * model operations, not raw SQL), so workspace_id is included in the WHERE by
 * hand here — it is what makes a foreign conversation id allocate nothing rather
 * than something.
 *
 * Returns null when the conversation does not exist in this workspace, which the
 * caller turns into 404.
 */
export async function allocateSequenceAndMaybeReopen(
  client: Tx,
  scope: WorkspaceScope,
  conversationId: string,
  senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM',
): Promise<{ sequence: number; status: ConversationStatus } | null> {
  const rows = await client.$queryRaw<Array<{ sequence: number; status: ConversationStatus }>>`
    UPDATE conversations
    SET message_count = message_count + 1,
        last_message_at = now(),
        status = CASE
          WHEN ${senderType} = 'CUSTOMER' AND status IN ('SNOOZED', 'RESOLVED')
          THEN 'OPEN'::"ConversationStatus"
          ELSE status
        END,
        snoozed_until = CASE
          WHEN ${senderType} = 'CUSTOMER' AND status IN ('SNOOZED', 'RESOLVED')
          THEN NULL
          ELSE snoozed_until
        END
    WHERE id = ${conversationId}::uuid AND workspace_id = ${scope.workspaceId}::uuid
    RETURNING message_count AS "sequence", status
  `;
  return rows[0] ?? null;
}

/**
 * Advances agent_last_read_sequence monotonically in one statement: GREATEST
 * makes "a lower value is ignored, not written" atomic rather than a
 * read-compare-write race (docs/18-execution.md). Same raw-query caveat as
 * above — workspace_id is in the WHERE by hand.
 */
export async function updateAgentReadSequence(
  scope: WorkspaceScope,
  conversationId: string,
  lastReadSequence: number,
): Promise<{ agentLastReadSequence: number } | null> {
  const rows = await db.$queryRaw<Array<{ agentLastReadSequence: number }>>`
    UPDATE conversations
    SET agent_last_read_sequence = GREATEST(agent_last_read_sequence, ${lastReadSequence})
    WHERE id = ${conversationId}::uuid AND workspace_id = ${scope.workspaceId}::uuid
    RETURNING agent_last_read_sequence AS "agentLastReadSequence"
  `;
  return rows[0] ?? null;
}
