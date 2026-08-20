import Redis, { type RedisOptions } from 'ioredis';

import { env } from '../env';
import { logger } from './logger';

/**
 * Redis is operational infrastructure, never the source of truth: queue backend,
 * rate-limit counters, short-lived presence, and the Socket.IO adapter if the app
 * is ever scaled horizontally. Losing it degrades features; it never loses data.
 */

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  lazyConnect: false,
};

export function createRedis(overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, { ...baseOptions, ...overrides });
  client.on('error', (err: Error) => {
    // Logged, not thrown: a Redis blip must not take the API process down.
    logger.error({ err: err.message }, 'redis error');
  });
  return client;
}

export const redis = createRedis();

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connections because it uses
 * blocking commands, so queues and workers get their own client rather than
 * sharing this one.
 */
export function createQueueConnection(): Redis {
  return createRedis({ maxRetriesPerRequest: null, enableReadyCheck: false });
}
