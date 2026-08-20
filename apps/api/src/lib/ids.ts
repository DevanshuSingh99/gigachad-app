import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Crockford base32, as used by ULID. Excludes I, L, O, and U so an id read aloud
 * or copied out of a log cannot be transcribed ambiguously.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID: 48 bits of millisecond timestamp then 80 bits of randomness, base32
 * encoded. Lexicographically sortable, which is what makes request ids useful to
 * grep a log by time range.
 */
export function newUlid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }

  const bytes = randomBytes(16);
  let random = '';
  for (let i = 0; i < 16; i++) {
    random += CROCKFORD[bytes[i]! % 32];
  }

  return time + random;
}

/** Appears in every log line and in every error body, for log correlation. */
export function newRequestId(): string {
  return `req_${newUlid()}`;
}

export function newUuid(): string {
  return randomUUID();
}

/** Public workspace key. Identifies a workspace and grants nothing on its own. */
export function newWidgetKey(): string {
  return `wk_live_${randomBytes(16).toString('hex')}`;
}
