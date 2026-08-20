import crypto from 'node:crypto';

import nodemailer from 'nodemailer';

import { env } from '../../env';
import { logger } from '../logger';

// ─── Inbound webhook types ─────────────────────────────────────────────────────

/** Shape of an address object inside a Brevo inbound payload. */
export interface BrevoAddress {
  Name: string;
  Address: string;
}

/**
 * Parsed Brevo inbound-email webhook payload.
 *
 * Optional fields reflect that Brevo omits them when they are empty in the
 * email (no reply-to, no references, etc.). The `Headers` map contains raw
 * RFC 2822 header values keyed by header name; `References` lives there
 * because Brevo does not surface it as a top-level field.
 */
export interface BrevoInboundPayload {
  /** One UUID per event — `Uuid[0]` is the provider event ID for deduplication. */
  Uuid: string[];
  /** RFC Message-ID with angle brackets. */
  MessageId: string;
  InReplyTo?: string;
  From: BrevoAddress;
  /** First entry is the primary recipient. */
  To: BrevoAddress[];
  SentAtDate?: string;
  Subject?: string;
  /** `text/plain` body — canonical content. */
  Text?: string;
  /** `text/html` body — sanitize before storing. */
  Html?: string;
  Headers?: Record<string, string>;
}

/** Shape of a Brevo transactional-event webhook payload (delivery status). */
export interface BrevoEventPayload {
  event: string;
  email: string;
  'message-id'?: string;
  ts?: number;
  reason?: string | null;
}

// ─── Outbound email types ──────────────────────────────────────────────────────

export interface SendEmailInput {
  to: Array<{ email: string; name?: string }>;
  from: { email: string; name?: string };
  replyTo: { email: string };
  subject: string;
  textContent: string;
  htmlContent?: string;
  /** Generated RFC-compliant Message-ID, angle-bracket-wrapped. */
  messageId: string;
  inReplyTo?: string;
  references?: string[];
}

export interface SendEmailResult {
  /** Provider-assigned message ID returned in the send response. */
  providerMessageId: string;
}

// ─── Provider interface ────────────────────────────────────────────────────────

export interface EmailProvider {
  /**
   * Returns true if the signature is valid.
   *
   * Fails closed when the signing secret is not configured: no secret means no
   * valid HMAC can ever be computed, so every request is rejected rather than
   * silently accepted. The env flag `emailWebhookVerificationEnabled` (tied to
   * `env.emailEnabled`, see env.ts) governs whether this is called at all —
   * when email is off entirely, there is nothing to verify against.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  parseInboundPayload(body: unknown): BrevoInboundPayload;
  parseEventPayload(body: unknown): BrevoEventPayload;
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

// ─── Webhook timestamp tolerance ────────────────────────────────────────────────

/**
 * Maximum age (in either direction — replay or clock skew) a webhook payload's
 * own timestamp may have before it is rejected as stale.
 *
 * Neither docs/07-email.md nor docs/09-security.md pins an exact number ("reject
 * old timestamps" / "timestamp tolerance" are mentioned without a value), so
 * this uses 5 minutes as a reasonable default — generous enough for normal
 * provider delivery latency, tight enough to make a replayed webhook useless.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * True when `timestampMs` is within `WEBHOOK_TIMESTAMP_TOLERANCE_MS` of now.
 * A missing or unparseable timestamp (`NaN`) is treated as stale — the same
 * fail-closed reasoning as an empty signing secret: if freshness cannot be
 * verified, the payload is rejected rather than silently accepted.
 */
export function isWebhookTimestampFresh(timestampMs: number): boolean {
  if (!Number.isFinite(timestampMs)) return false;
  return Math.abs(Date.now() - timestampMs) <= WEBHOOK_TIMESTAMP_TOLERANCE_MS;
}

// ─── Brevo / SMTP implementation ──────────────────────────────────────────────

/** Maps Brevo event strings to our DeliveryStatus enum values. */
const EVENT_TO_STATUS: Record<string, string> = {
  delivered: 'DELIVERED',
  soft_bounce: 'FAILED',
  hard_bounce: 'BOUNCED',
  invalid_email: 'BOUNCED',
  deferred: 'PENDING',
  blocked: 'FAILED',
  spam: 'FAILED',
  unsubscribed: 'FAILED',
  click: 'DELIVERED',
  opened: 'DELIVERED',
  sent: 'SENT',
};

/**
 * Creates a nodemailer transporter from the SMTP env vars.
 * Called lazily inside sendEmail so the module can be imported before env is
 * fully loaded in tests.
 */
function createTransport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === true,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    // 15 s connection + send timeout, matching TIMEOUTS.emailProviderMs.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

class BrevoProvider implements EmailProvider {
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    // Fail closed: with no secret configured, no valid signature can ever be
    // computed, so every request must be rejected rather than let through
    // unauthenticated (previously this returned true here).
    if (!env.BREVO_WEBHOOK_SIGNING_SECRET) return false;
    const hmac = crypto.createHmac('sha256', env.BREVO_WEBHOOK_SIGNING_SECRET);
    hmac.update(rawBody);
    const expected = hmac.digest('hex');
    try {
      const expectedBuf = Buffer.from(expected, 'utf8');
      const actualBuf = Buffer.from(signature, 'utf8');
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  parseInboundPayload(body: unknown): BrevoInboundPayload {
    if (!body || typeof body !== 'object') {
      throw new Error('Inbound webhook body is not an object');
    }
    const b = body as Record<string, unknown>;
    if (!Array.isArray(b.Uuid) || b.Uuid.length === 0) {
      throw new Error('Inbound webhook missing Uuid');
    }
    if (typeof b.MessageId !== 'string') {
      throw new Error('Inbound webhook missing MessageId');
    }
    if (!b.From || typeof b.From !== 'object') {
      throw new Error('Inbound webhook missing From');
    }
    if (!Array.isArray(b.To) || b.To.length === 0) {
      throw new Error('Inbound webhook missing To');
    }
    return body as BrevoInboundPayload;
  }

  parseEventPayload(body: unknown): BrevoEventPayload {
    if (!body || typeof body !== 'object') {
      throw new Error('Event webhook body is not an object');
    }
    const b = body as Record<string, unknown>;
    if (typeof b.event !== 'string') {
      throw new Error('Event webhook missing event field');
    }
    return body as BrevoEventPayload;
  }

  /**
   * Sends an email via the configured SMTP relay (Brevo or any other provider).
   *
   * Threading headers (`Message-ID`, `In-Reply-To`, `References`) are set
   * explicitly so customer replies thread back into the same conversation.
   */
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (!env.SMTP_HOST) {
      throw new Error('SMTP_HOST is not configured');
    }

    const fromAddress = `${input.from.name ? `${input.from.name} ` : ''}<${input.from.email}>`;
    const toAddresses = input.to
      .map((t) => (t.name ? `${t.name} <${t.email}>` : t.email))
      .join(', ');
    const refsHeader =
      input.references && input.references.length > 0
        ? input.references.join(' ')
        : undefined;

    const transporter = createTransport();

    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: toAddresses,
        replyTo: input.replyTo.email,
        subject: input.subject,
        text: input.textContent,
        ...(input.htmlContent ? { html: input.htmlContent } : {}),
        headers: {
          'Message-ID': input.messageId,
          ...(input.inReplyTo ? { 'In-Reply-To': input.inReplyTo } : {}),
          ...(refsHeader ? { References: refsHeader } : {}),
        },
      });

      logger.info({ messageId: info.messageId }, 'email sent via SMTP');
      return { providerMessageId: info.messageId ?? input.messageId };
    } finally {
      transporter.close();
    }
  }

  /** Maps a Brevo event string to our `DeliveryStatus` enum. Unknown events are ignored. */
  mapEventStatus(event: string): string | null {
    return EVENT_TO_STATUS[event] ?? null;
  }
}

export const brevoProvider = new BrevoProvider();
export { EVENT_TO_STATUS };
