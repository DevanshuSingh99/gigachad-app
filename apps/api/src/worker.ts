import type { Worker } from 'bullmq';

import { createPrismaClient } from './db';
import { logger } from './lib/logger';
import { createQueueConnection } from './lib/redis';
import { TIMEOUTS } from '@gigachad/shared';
import { createEmailSendWorker, onEmailSendFailed } from './modules/email/jobs/emailSendJob';
import { createAiSummaryWorker } from './modules/ai/jobs/summaryJob';
import type { EmailSendJobData } from './lib/email/queue';

/**
 * Worker entry point. Runs from the same image as the API but as its own process,
 * so a long LLM call or a provider retry never occupies a request handler.
 *
 * Jobs registered here: outbound email send (Phase E). AI summaries and domain
 * verification follow in Phases G and H.
 */

/** A worker gets a longer statement timeout than a request handler. */
const db = createPrismaClient({ statementTimeoutMs: TIMEOUTS.dbStatementWorkerMs });
const connection = createQueueConnection();

// ─── Email send worker ────────────────────────────────────────────────────────

const emailWorker = createEmailSendWorker(db, connection);

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'email send job failed');
  void onEmailSendFailed(db, job as { data: EmailSendJobData } | undefined);
});

emailWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'email send job completed');
});

// ─── AI summary worker ────────────────────────────────────────────────────────

const aiWorker = createAiSummaryWorker(db, connection);

aiWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'ai summary job failed');
});

aiWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'ai summary job completed');
});

// ─────────────────────────────────────────────────────────────────────────────

const workers: Worker[] = [emailWorker, aiWorker];

logger.info({ workers: workers.length }, 'worker started');

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');

  // Close workers first so each finishes its active job rather than having it
  // reappear as a duplicate on the next boot.
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([db.$disconnect(), connection.quit()]);
  logger.info('worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'worker unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'worker uncaught exception');
  process.exit(1);
});

export { db, connection, workers };
