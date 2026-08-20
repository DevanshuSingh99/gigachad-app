import type { Worker } from 'bullmq';

import { createPrismaClient } from './db';
import { logger } from './lib/logger';
import { createQueueConnection } from './lib/redis';
import { TIMEOUTS } from '@gigachad/shared';

/**
 * Worker entry point. Runs from the same image as the API but as its own process,
 * so a long LLM call or a provider retry never occupies a request handler.
 *
 * Jobs are registered here by later phases: AI summaries (Phase G), outbound email
 * and delivery retries (Phase E), and domain verification (Phase H). All of them
 * are idempotent and operate only on committed ids.
 */

/** A worker gets a longer statement timeout than a request handler. */
const db = createPrismaClient({ statementTimeoutMs: TIMEOUTS.dbStatementWorkerMs });
const connection = createQueueConnection();

const workers: Worker[] = [];

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
