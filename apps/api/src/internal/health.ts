import { Router } from 'express';

import { db, unscoped } from '../db';
import { redis } from '../lib/redis';

/**
 * Health endpoints. Compose gates the API's own healthcheck and Caddy's start on
 * `/health/ready`, so what this reports decides whether a deploy proceeds.
 *
 * Neither endpoint exposes connection strings, versions, or credentials — a
 * readiness probe is reachable from anywhere Caddy is.
 */
export const healthRouter = Router();

/** Process liveness only: answers as long as the event loop is turning. */
healthRouter.get('/live', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

/** Dependency readiness: PostgreSQL and Redis both reachable. */
healthRouter.get('/ready', async (req, res) => {
  const checks: Record<string, 'ok' | 'error'> = { database: 'error', redis: 'error' };

  const [database, cache] = await Promise.allSettled([
    unscoped('readiness probe: SELECT 1', () => db.$queryRaw`SELECT 1`),
    redis.ping(),
  ]);

  checks.database = database.status === 'fulfilled' ? 'ok' : 'error';
  checks.redis = cache.status === 'fulfilled' ? 'ok' : 'error';

  const ready = Object.values(checks).every((v) => v === 'ok');
  if (!ready) {
    req.log.error(
      {
        checks,
        databaseError:
          database.status === 'rejected' ? (database.reason as Error)?.message : undefined,
        redisError: cache.status === 'rejected' ? (cache.reason as Error)?.message : undefined,
      },
      'readiness check failed',
    );
  }

  res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'unready', checks } });
});
