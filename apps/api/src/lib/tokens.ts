import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../env';

/**
 * Opaque tokens and their hashes.
 *
 * The pattern is the same for sessions, invitations, and widget sessions: the
 * bearer gets a high-entropy random string, the database stores only its keyed
 * hash. A database disclosure therefore does not hand over usable credentials,
 * and nothing anywhere has to decrypt a token to check it.
 */

/** 32 bytes of entropy, URL-safe. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Keyed with SESSION_SECRET rather than a bare SHA-256 so that a stolen table of
 * hashes cannot be attacked with precomputed digests.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

/** Constant-time comparison, for anywhere a secret is compared directly. */
export function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
