import { z } from 'zod';

/**
 * Configuration, validated once at boot. Every variable listed in
 * docs/10-deployment.md appears here, and the process refuses to start on a
 * missing required value rather than failing later on the first request that
 * needs it.
 *
 * Two variables are deliberately absent and stay gone:
 *   * WIDGET_ORIGIN_ALLOWLIST — allowed widget origins are per-workspace
 *     settings, since each tenant installs on its own site.
 *   * CLOUDFLARE_API_TOKEN / ZONE_ID — certificate issuance is Caddy's job, so
 *     there is no DNS API call to make.
 */

const nonEmpty = z.string().trim().min(1);

/** Accepts an empty value as "not set", which is how optional provider keys read in .env. */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: nonEmpty.startsWith('postgres'),
  REDIS_URL: nonEmpty.startsWith('redis'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32'),
  /**
   * Leading-dot apex, e.g. `.example.com`, so app.<apex> to api.<apex> requests
   * are same-site and the HttpOnly session cookie is sent normally. Empty means
   * a host-only cookie, which is what local development wants.
   */
  COOKIE_DOMAIN: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional(),
  API_URL: nonEmpty.url(),
  /** Exact origin. Never a wildcard: a wildcard cannot carry credentials. */
  DASHBOARD_ORIGIN: nonEmpty.url(),

  KB_HOST: nonEmpty,
  KB_CNAME_TARGET: nonEmpty,

  /**
   * Inbound email domain, e.g. `inbound.example.com`. Optional: if not set,
   * inbound routing is disabled and Reply-To falls back to the sending address.
   */
  INBOUND_EMAIL_DOMAIN: optionalString,

  // ── SMTP outbound (Brevo relay or any SMTP provider) ──────────────────────
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .string()
    .trim()
    .transform((v) => v === 'true')
    .optional()
    .default('false'),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  /** RFC-5321 From address, e.g. `Support <support@example.com>`. */
  EMAIL_FROM: optionalString,

  // ── Brevo HTTP API (optional; only needed for inbound webhook verification) ──
  BREVO_API_KEY: optionalString,
  BREVO_WEBHOOK_SIGNING_SECRET: optionalString,
  /** Legacy alias — EMAIL_FROM takes precedence. */
  MAIL_FROM: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: z.string().trim().default('gpt-4o-mini'),
  AI_SUMMARY_MIN_MESSAGES: z.coerce.number().int().min(2).max(50).default(6),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Deliberately not the logger: this runs before the logger is configured,
    // and a boot failure has to be readable in `docker compose logs`.
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

const raw = load();

/**
 * Email is enabled when an SMTP host (or legacy Brevo API key) plus a sender
 * address are configured. Without them, outbound sends report EMAIL_SEND_FAILED
 * and nothing silently pretends to work.
 *
 * Computed once here (rather than inline in the `env` object literal below) so
 * `emailWebhookVerificationEnabled` can be derived from the same value instead
 * of a second, independent check.
 */
const emailEnabled = Boolean(
  (raw.SMTP_HOST || raw.BREVO_API_KEY) && (raw.EMAIL_FROM ?? raw.MAIL_FROM),
);

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /** Resolved sender address: EMAIL_FROM wins, MAIL_FROM is the legacy fallback. */
  mailFrom: raw.EMAIL_FROM ?? raw.MAIL_FROM,
  /**
   * AI is optional by design: with no key the summary panel reports AI
   * unavailable and every other feature keeps working.
   */
  aiEnabled: Boolean(raw.OPENAI_API_KEY),
  emailEnabled,
  /**
   * Whether the inbound/event webhooks verify the provider signature and
   * timestamp before processing.
   *
   * Tied to `emailEnabled`, NOT to whether `BREVO_WEBHOOK_SIGNING_SECRET` is
   * itself set — verification must never be silently skipped just because the
   * secret is empty. If email is on but the secret was never configured, that
   * is a misconfiguration: `verifyWebhookSignature()` (lib/email/provider.ts)
   * fails closed on a missing secret, so every webhook is correctly rejected
   * instead of accepted unauthenticated. When email is off entirely (e.g. a
   * bare local dev checkout), there is nothing configured to verify against,
   * so the route can boot without one.
   */
  emailWebhookVerificationEnabled: emailEnabled,
} as const;

export type Env = typeof env;

/**
 * `<slug>@inbound.<domain>` for the Reply-To header.
 * Falls back to the sending address if no inbound domain is configured.
 */
export function supportAddressFor(slug: string): string {
  if (env.INBOUND_EMAIL_DOMAIN) {
    return `${slug}@${env.INBOUND_EMAIL_DOMAIN}`;
  }
  return env.mailFrom ?? `${slug}@gigachad.app`;
}
