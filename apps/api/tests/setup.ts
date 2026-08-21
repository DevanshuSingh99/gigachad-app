import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs before any test file imports `src/`. env.ts validates at import time,
 * so DATABASE_URL / SESSION_SECRET / origins must already be set.
 */

function loadDotenv(file: string): void {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // No repo .env — defaults below still let unit tests boot.
  }
}

loadDotenv(resolve(__dirname, '../../../.env'));

function rewriteDockerHost(url: string | undefined, fromHost: string): string | undefined {
  if (!url) return url;
  return url.includes(`@${fromHost}:`)
    ? url.replace(`@${fromHost}:`, '@127.0.0.1:')
    : url.replace(`://${fromHost}:`, '://127.0.0.1:');
}

process.env.DATABASE_URL = rewriteDockerHost(process.env.DATABASE_URL, 'postgres');
process.env.REDIS_URL = rewriteDockerHost(process.env.REDIS_URL, 'redis');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'fatal';
process.env.PORT = process.env.PORT ?? '3000';
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
    ? process.env.SESSION_SECRET
    : 'test-session-secret-must-be-32bytes!';
process.env.API_URL = process.env.API_URL ?? 'http://localhost:3000';
process.env.DASHBOARD_ORIGIN = 'http://localhost:3001';
process.env.KB_HOST = process.env.KB_HOST ?? 'kb.test';
process.env.KB_CNAME_TARGET = process.env.KB_CNAME_TARGET ?? 'kb.test';
process.env.COOKIE_DOMAIN = '';
process.env.INBOUND_EMAIL_DOMAIN = 'inbound.test';
process.env.SMTP_HOST = process.env.SMTP_HOST ?? '127.0.0.1';
process.env.EMAIL_FROM = process.env.EMAIL_FROM ?? 'support@test.example';
process.env.BREVO_WEBHOOK_SIGNING_SECRET = 'test-webhook-secret';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:replace-me@127.0.0.1:5432/gigachad?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
