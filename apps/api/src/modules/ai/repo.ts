import type { SummaryState } from '@gigachad/shared';

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

export function upsertSummaryQueued(
  client: Tx,
  workspaceId: string,
  conversationId: string,
) {
  return client.aiSummary.upsert({
    where: { workspaceId_conversationId: { workspaceId, conversationId } },
    create: {
      workspaceId,
      conversationId,
      state: 'QUEUED',
    },
    update: {
      state: 'QUEUED',
    },
    select: { id: true },
  });
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
