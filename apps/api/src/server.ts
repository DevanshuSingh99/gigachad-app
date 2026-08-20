import { createServer } from 'node:http';

import { createApp } from './app';
import { db } from './db';
import { env } from './env';
import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { attachSocketServer } from './realtime/io';

/**
 * API entry point. Socket.IO attaches to this same HTTP server rather than a
 * second port, so one process serves REST and WebSocket traffic identically in
 * dev and in the single-VM production deploy (docs/03-architecture.md).
 */

const app = createApp();
const server = createServer(app);
const io = attachSocketServer(server);

server.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      nodeEnv: env.NODE_ENV,
      aiEnabled: env.aiEnabled,
      emailEnabled: env.emailEnabled,
    },
    'api listening',
  );
});

/**
 * Graceful shutdown. Compose sends SIGTERM on `up -d --build`, and an in-flight
 * write that is killed mid-transaction is the kind of thing that shows up later as
 * a mysterious missing message.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // Stop accepting connections, then give in-flight requests a bounded moment.
  io.close();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000).unref());
  await Promise.race([closed, timeout]);

  await Promise.allSettled([db.$disconnect(), redis.quit()]);
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  // Unknown state after this point, so exit and let the restart policy take over.
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
