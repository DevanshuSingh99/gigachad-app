import { Queue } from 'bullmq';

import { createQueueConnection } from '../redis';

export const AI_SUMMARY_QUEUE = 'ai-summary';

export interface AiSummaryJobData {
  workspaceId: string;
  conversationId: string;
}

/**
 * Queue for AI summary generation jobs.
 *
 * Job ids are `ai-summary:{conversationId}:{timestamp}` — unique per enqueue
 * attempt. They are NOT the in-flight-duplicate dedup key: BullMQ keeps
 * completed/failed job records around (removeOnComplete/removeOnFail below
 * are counts, not immediate deletion), so re-adding with the same job id
 * after a prior job finished silently no-ops forever. Deduplicating two
 * rapid clicks on "Generate" is instead handled at the DB level, by checking
 * the AiSummary row's `state === 'QUEUED'` before ever calling `queue.add`
 * (see modules/ai/service.ts `triggerSummary`).
 */
export const aiSummaryQueue = new Queue<AiSummaryJobData>(AI_SUMMARY_QUEUE, {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1_000 },
  },
});
