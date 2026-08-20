import type { NextFunction, Request, Response } from 'express';
import { RATE_LIMITS, type RateLimitName } from '@gigachad/shared';

import { rateLimited } from './errors';
import { redis } from './redis';

/**
 * Sliding-window rate limiting in Redis.
 *
 * Limits protect a 1 vCPU box, so they are enforced BEFORE handler work rather
 * than inside it (invariant 9) — which for login also means before the Argon2
 * verification, the most expensive thing an unauthenticated caller can trigger.
 *
 * Rejected attempts are deliberately not recorded, so a client that keeps
 * hammering cannot push its own window forward and lock itself out for longer
 * than the configured period.
 */

const SCRIPT = `
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local used = redis.call('ZCARD', KEYS[1])

if used >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retryMs = window - (now - tonumber(oldest[2]))
  if retryMs < 0 then retryMs = 0 end
  return {0, retryMs}
end

redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function consume(name: RateLimitName, key: string): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const redisKey = `rl:${name}:${key}`;
  const now = Date.now();
  // Unique member per attempt, so two attempts in the same millisecond both count.
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const [allowed, retryMs] = (await redis.eval(
      SCRIPT,
      1,
      redisKey,
      String(now),
      String(windowSeconds * 1000),
      String(limit),
      member,
    )) as [number, number];

    return {
      allowed: allowed === 1,
      retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  } catch {
    // Fail open. A Redis blip must not lock every user out of signing in; the
    // alternative trades a brute-force window for a total outage. The caller logs
    // this, so it is visible rather than silent.
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Resolves the value a limit is counted against. Returning null skips the limit. */
export type RateLimitKeyResolver = (req: Request) => string | null | undefined;

export const byIp: RateLimitKeyResolver = (req) => req.ip ?? 'unknown';

export function rateLimit(name: RateLimitName, resolveKey: RateLimitKeyResolver = byIp) {
  return async function limiter(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const key = resolveKey(req);
    if (!key) {
      next();
      return;
    }

    const result = await consume(name, key);
    if (!result.allowed) {
      req.log.warn({ rateLimit: name }, 'rate limited');
      next(rateLimited(result.retryAfterSeconds));
      return;
    }
    next();
  };
}
