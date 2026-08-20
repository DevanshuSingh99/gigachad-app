import { randomBytes } from 'node:crypto';

import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Password hashing with Argon2id.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet's Argon2id baseline
 * (19 MiB, 2 iterations, 1 lane). They matter on a 1 vCPU box: raising memory or
 * iterations further would make login the slowest thing the API does, and this
 * configuration already puts a single guess well outside useful brute-force range.
 */
const PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  // Argon2 encodes its parameters in the hash string, so an old hash keeps
  // verifying if PARAMS is ever raised.
  return verify(hashed, plain);
}

/**
 * A throwaway hash used to make a login attempt for an unknown email cost the
 * same as one for a known email.
 *
 * Returning early when no user exists would leak account existence through
 * response time, which defeats the identical error message the login endpoint is
 * careful to return. Verifying against this instead keeps both paths doing one
 * Argon2 verification.
 *
 * Computed once, lazily, and cached — the first login pays for it, not boot.
 */
let dummyHash: Promise<string> | null = null;

export function timingEqualizerHash(): Promise<string> {
  dummyHash ??= hash(randomBytes(32).toString('hex'), PARAMS);
  return dummyHash;
}

/** Burns one verification against a hash nothing can match. */
export async function burnPasswordVerification(plain: string): Promise<void> {
  try {
    await verify(await timingEqualizerHash(), plain);
  } catch {
    // Never throws to the caller: this exists only to consume time.
  }
}
