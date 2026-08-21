import { AI, type SummaryState } from '@gigachad/shared';

import { db, type Tx, unscoped } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

// ─── Reads ─────────────────────────────────────────────────────────────────────

export const SUMMARY_SELECT = {
  id: true,
  conversationId: true,
  workspaceId: true,
  summaryText: true,
  userWants: true,
  tried: true,
  currentStatus: true,
  sourceMessageCount: true,
  sourceLastMessageId: true,
  state: true,
  errorCode: true,
  model: true,
  promptVersion: true,
  updatedAt: true,
} as const;

export function findSummary(scope: WorkspaceScope, conversationId: string) {
  return db.aiSummary.findFirst({
    where: { workspaceId: scope.workspaceId, conversationId },
    select: SUMMARY_SELECT,
  });
}

/** Load the summary inside a transaction (for the worker). */
export function findSummaryForUpdate(
  client: Tx,
  workspaceId: string,
  conversationId: string,
) {
  return client.aiSummary.findFirst({
    where: { workspaceId, conversationId },
    select: SUMMARY_SELECT,
  });
}

/** Loads messages to build the prompt context. Newest first, capped at 30. */
export async function loadMessageContext(
  workspaceId: string,
  conversationId: string,
): Promise<Array<{ senderType: string; bodyText: string }>> {
  return unscoped('load messages for ai summary context', () =>
    db.message.findMany({
      where: { workspaceId, conversationId },
      select: { senderType: true, bodyText: true },
      orderBy: { sequence: 'desc' },
      take: 30,
    }),
  );
}

/** Returns the conversation's current messageCount and most recent message id. */
export function loadConversationStats(workspaceId: string, conversationId: string) {
  return unscoped('load conversation stats for ai summary', () =>
    db.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: {
        messageCount: true,
        messages: {
          orderBy: { sequence: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    }),
  );
}

// ─── Writes ────────────────────────────────────────────────────────────────────

/**
 * Atomically transitions a summary row to QUEUED, but only if it is not
 * already QUEUED-and-fresh — one statement, so it is the single source of
 * truth for "may I enqueue a job", not a separate read the caller reasons
 * about beforehand. Returns true iff THIS call won the transition; the caller
 * should enqueue a worker job only in that case.
 *
 * Without this, two near-simultaneous triggerSummary calls can both read a
 * non-QUEUED (or stale-QUEUED) row before either writes, both pass
 * service.ts's in-memory check, and both enqueue a job — whichever job's
 * transaction commits last then overwrites the other's
 * sourceMessageCount/sourceLastMessageId with stale values, corrupting the
 * staleness watermark getSummary() relies on (docs/08-ai.md).
 */
export async function tryMarkQueued(
  client: Tx,
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO ai_summaries (id, workspace_id, conversation_id, state, created_at, updated_at)
    VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${conversationId}::uuid, 'QUEUED', now(), now())
    ON CONFLICT (workspace_id, conversation_id) DO UPDATE
      SET state = 'QUEUED', updated_at = now()
      WHERE NOT (
        ai_summaries.state = 'QUEUED'
        AND ai_summaries.updated_at > now() - make_interval(secs => ${AI.queuedStaleSeconds})
      )
    RETURNING id
  `;
  return rows.length > 0;
}

export function updateSummaryReady(
  client: Tx,
  workspaceId: string,
  conversationId: string,
  data: {
    userWants: string;
    tried: string;
    currentStatus: string;
    sourceMessageCount: number;
    sourceLastMessageId: string;
    model: string;
    promptVersion: string;
  },
) {
  const summaryText = [
    `Goal: ${data.userWants}`,
    `Tried: ${data.tried}`,
    `Status: ${data.currentStatus}`,
  ].join('\n\n');

  return client.aiSummary.update({
    where: { workspaceId_conversationId: { workspaceId, conversationId } },
    data: {
      state: 'READY',
      summaryText,
      userWants: data.userWants,
      tried: data.tried,
      currentStatus: data.currentStatus,
      sourceMessageCount: data.sourceMessageCount,
      sourceLastMessageId: data.sourceLastMessageId,
      model: data.model,
      promptVersion: data.promptVersion,
      errorCode: null,
    },
    select: SUMMARY_SELECT,
  });
}

export function updateSummaryError(
  client: Tx,
  workspaceId: string,
  conversationId: string,
  errorCode: string,
) {
  return client.aiSummary.update({
    where: { workspaceId_conversationId: { workspaceId, conversationId } },
    data: { state: 'ERROR', errorCode },
    select: SUMMARY_SELECT,
  });
}
