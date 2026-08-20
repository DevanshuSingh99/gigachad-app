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

  INBOUND_EMAIL_DOMAIN: nonEmpty,
  BREVO_API_KEY: optionalString,
  BREVO_WEBHOOK_SIGNING_SECRET: optionalString,
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

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /**
   * AI is optional by design: with no key the summary panel reports AI
   * unavailable and every other feature keeps working (docs/08-ai.md).
   */
  aiEnabled: Boolean(raw.OPENAI_API_KEY),
  /**
   * Without Brevo credentials, inbound webhook verification fails closed and
   * outbound sends report EMAIL_SEND_FAILED. Nothing silently pretends to work.
   */
  emailEnabled: Boolean(raw.BREVO_API_KEY && raw.MAIL_FROM),
  emailWebhookVerificationEnabled: Boolean(raw.BREVO_WEBHOOK_SIGNING_SECRET),
} as const;

export type Env = typeof env;

/** `<slug>@inbound.<domain>` — stored on the workspace so it survives a domain change. */
export function supportAddressFor(slug: string): string {
  return `${slug}@${env.INBOUND_EMAIL_DOMAIN}`;
}
