import { Queue } from 'bullmq';

import { createQueueConnection } from '../redis';

export const EMAIL_SEND_QUEUE = 'email-send';

/**
 * Queue for outbound email send jobs.
 *
 * Shared by API and worker (same queue name, separate connections). The API
 * adds jobs; the worker in apps/api/src/worker.ts processes them.
 */
export const emailSendQueue = new Queue<EmailSendJobData>(EMAIL_SEND_QUEUE, {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  },
});

/** Data passed to each email-send job. Only committed IDs are queued. */
export interface EmailSendJobData {
  /** `EmailMessage.id` of the OUTBOUND row to send. */
  emailMessageId: string;
  /** `Message.id` of the linked inbox message (for context in logs). */
  gigachadMessageId: string;
  /** Workspace ID — for tenant-scoped DB lookups inside the worker. */
  workspaceId: string;
  /** Conversation ID — for emit after successful send. */
  conversationId: string;
}
