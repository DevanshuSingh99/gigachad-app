import { Worker } from 'bullmq';
import { AI } from '@gigachad/shared';

import type { Db } from '../../../db';
import { env } from '../../../env';
import { generateSummary, PROMPT_VERSION } from '../../../lib/ai/llm';
import { AI_SUMMARY_QUEUE, type AiSummaryJobData } from '../../../lib/ai/queue';
import { logger } from '../../../lib/logger';
import { emitSummaryUpdated } from '../../../realtime/emit';
import * as repo from '../repo';
import type Redis from 'ioredis';

/**
 * No tokenizer runs in the request path (docs/08-ai.md) — the total context
 * budget is enforced with this rough chars-per-token approximation instead.
 */
const CHARS_PER_TOKEN_APPROX = 4;

/**
 * BullMQ worker for AI summary generation.
 *
 * The job:
 *  1. Loads the last 30 messages (1,500 chars each, ~8,000 total tokens) as
 *     prompt context.
 *  2. Calls the LLM with up to 2 retries on schema violation.
 *  3. Stores READY on success, ERROR (+ AI_INVALID_OUTPUT) on final failure —
 *     always keeping the previous good summary in place.
 *  4. Emits `summary:updated` so the dashboard panel refreshes without polling.
 *
 * Errors thrown from the processor cause BullMQ to retry the job (up to 3
 * attempts with exponential backoff). Only the final `AI_INVALID_OUTPUT` path
 * is handled here; transient provider errors propagate and are retried.
 */
export function createAiSummaryWorker(db: Db, connection: Redis): Worker<AiSummaryJobData> {
  return new Worker<AiSummaryJobData>(
    AI_SUMMARY_QUEUE,
    async (job) => {
      const { workspaceId, conversationId } = job.data;

      logger.info({ jobId: job.id, conversationId }, 'ai summary job started');

      if (!env.aiEnabled) {
        logger.warn({ conversationId }, 'ai summary skipped: AI not enabled');
        return;
      }

      // ── Load message context ──────────────────────────────────────────────
      const messages = await repo.loadMessageContext(workspaceId, conversationId);
      if (messages.length === 0) {
        logger.warn({ conversationId }, 'ai summary: no messages found');
        return;
      }

      // Build prompt: newest first, each capped at 1,500 chars.
      const contextLines = messages.map((m) => {
        const role = m.senderType === 'AGENT' ? 'Agent' : 'Customer';
        const text = m.bodyText.slice(0, 1_500);
        return `[${role}] ${text}`;
      });

      // Enforce the total context budget (~8,000 tokens per docs/08-ai.md;
      // approximated as ~4 chars/token since the request path uses no
      // tokenizer). `contextLines` is newest-first, so trimming from the end
      // drops the OLDEST messages first, keeping the most recent ones intact.
      const maxContextChars = AI.totalContextTokens * CHARS_PER_TOKEN_APPROX;
      while (contextLines.length > 1 && contextLines.join('\n\n').length > maxContextChars) {
        contextLines.pop();
      }

      const messageContext = contextLines.join('\n\n');

      // Include the previous summary text if one exists.
      const existingRow = await repo.findSummaryForUpdate(db, workspaceId, conversationId);
      const previousSummary =
        existingRow?.state === 'READY' && existingRow.summaryText
          ? existingRow.summaryText
          : undefined;

      // ── Call LLM ─────────────────────────────────────────────────────────
      let output: Awaited<ReturnType<typeof generateSummary>>;
      try {
        output = await generateSummary(messageContext, previousSummary);
      } catch (err) {
        logger.error({ err, conversationId }, 'ai summary: llm call failed');
        throw err; // BullMQ will retry
      }

      // Load conversation stats to record staleness watermark.
      const stats = await repo.loadConversationStats(workspaceId, conversationId);
      const lastMsgId = stats?.messages[0]?.id ?? null;
      const msgCount = stats?.messageCount ?? messages.length;

      await db.$transaction(async (tx) => {
        if (!output) {
          // Schema-validated failure after retries → store ERROR, keep previous summary.
          await repo.updateSummaryError(tx, workspaceId, conversationId, 'AI_INVALID_OUTPUT');
          logger.warn({ conversationId }, 'ai summary stored as ERROR (invalid output)');
        } else {
          await repo.updateSummaryReady(tx, workspaceId, conversationId, {
            userWants: output.userWants,
            tried: output.tried,
            currentStatus: output.currentStatus,
            sourceMessageCount: msgCount,
            sourceLastMessageId: lastMsgId ?? '',
            model: env.OPENAI_MODEL,
            promptVersion: PROMPT_VERSION,
          });
          logger.info({ conversationId }, 'ai summary stored as READY');
        }
      });

      // ── Emit socket event ─────────────────────────────────────────────────
      const finalRow = await repo.findSummaryForUpdate(db, workspaceId, conversationId);
      if (finalRow) {
        emitSummaryUpdated(workspaceId, conversationId, {
          conversationId,
          state: finalRow.state as 'QUEUED' | 'READY' | 'ERROR',
          updatedAt: finalRow.updatedAt.toISOString(),
        });
      }
    },
    {
      connection,
      concurrency: 2,
    },
  );
}
