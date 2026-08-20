import pino from 'pino';

import { env } from '../env';

/**
 * Structured logging: one JSON line per request, job, and webhook. Field list in
 * docs/16-errors-and-limits.md.
 *
 * Redaction is applied by the logger itself, by key name, at any depth — so a
 * future `log.info(req.body)` cannot leak. It must not depend on every call site
 * remembering.
 */

/**
 * Never logged: credentials, tokens, secrets, message and article bodies, raw
 * email, and full LLM prompts. Compared case-insensitively with `_` and `-`
 * stripped, so `password_hash`, `passwordHash`, and `Password-Hash` all match.
 */
const REDACTED_KEYS = new Set(
  [
    // Credentials and secrets
    'authorization',
    'cookie',
    'setcookie',
    'password',
    'passwordhash',
    'newpassword',
    'currentpassword',
    'secret',
    'sessionsecret',
    'apikey',
    'openaiapikey',
    'brevoapikey',
    'signingsecret',
    'webhooksigningsecret',
    'signature',
    'xhubsignature',
    // Tokens
    'token',
    'tokenhash',
    'accesstoken',
    'refreshtoken',
    'sessiontoken',
    'visitortoken',
    'publictokenhash',
    'widgetkey',
    'verificationtoken',
    // Customer content
    'body',
    'bodytext',
    'bodyhtml',
    'text',
    'html',
    'rawheaders',
    'rawheadersjson',
    'summarytext',
    // LLM
    'prompt',
    'prompts',
    'promptmessages',
    'completion',
  ].map((k) => k.replace(/[_-]/g, '')),
);

const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

function isRedactedKey(key: string): boolean {
  return REDACTED_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));
}

/**
 * Walks the log object replacing sensitive values by key name. pino's own
 * `redact.paths` only matches fixed paths, which would miss anything nested at an
 * unexpected depth — exactly the case this guards against.
 */
function redactDeep(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => redactDeep(v, depth + 1, seen));
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isRedactedKey(key) ? REDACTED : redactDeep(v, depth + 1, seen);
  }
  return out;
}

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'gigachad-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    log: (obj) => redactDeep(obj) as Record<string, unknown>,
  },
});

export type Logger = typeof logger;

/** Exported for the unit test that asserts redaction happens by key name. */
export const __testing = { redactDeep, isRedactedKey };
