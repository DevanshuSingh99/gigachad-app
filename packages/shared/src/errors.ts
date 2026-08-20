/**
 * Error code catalog. Single source of truth: docs/16-errors-and-limits.md.
 *
 * `code` is stable and safe for clients to branch on; `message` is human-facing
 * and may change. Every API failure response is
 * `{ error: { code, message, requestId, fieldErrors? } }`.
 */

export const ERROR_CODES = [
  // Authentication and authorization
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN_ROLE',
  'CSRF_FAILED',
  'WIDGET_ORIGIN_NOT_ALLOWED',
  'INVITATION_INVALID',
  // Resources
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'SLUG_TAKEN',
  'INVALID_TRANSITION',
  'STALE_WRITE',
  'LAST_ADMIN',
  'CATEGORY_NOT_EMPTY',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  // Channel, AI, and domains
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_RECIPIENT_UNKNOWN',
  'EMAIL_SEND_FAILED',
  'AI_BELOW_THRESHOLD',
  'AI_UNAVAILABLE',
  'AI_INVALID_OUTPUT',
  'AI_COOLDOWN',
  'DOMAIN_INVALID',
  'DOMAIN_VERIFICATION_FAILED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status for each code, exactly as tabulated in docs/16-errors-and-limits.md. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN_ROLE: 403,
  CSRF_FAILED: 403,
  WIDGET_ORIGIN_NOT_ALLOWED: 403,
  INVITATION_INVALID: 410,

  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  SLUG_TAKEN: 409,
  INVALID_TRANSITION: 409,
  STALE_WRITE: 409,
  LAST_ADMIN: 409,
  CATEGORY_NOT_EMPTY: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,

  WEBHOOK_SIGNATURE_INVALID: 401,
  // Deliberately 200: an unroutable local part is acknowledged so the provider
  // does not retry mail that can never be delivered. See docs/07-email.md.
  WEBHOOK_RECIPIENT_UNKNOWN: 200,
  EMAIL_SEND_FAILED: 502,
  AI_BELOW_THRESHOLD: 409,
  AI_UNAVAILABLE: 503,
  AI_INVALID_OUTPUT: 502,
  AI_COOLDOWN: 429,
  DOMAIN_INVALID: 422,
  DOMAIN_VERIFICATION_FAILED: 409,
  INTERNAL: 500,
};

/** Default human-facing message per code. Handlers may override. */
export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in to continue.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  FORBIDDEN_ROLE: 'Your role does not permit this action.',
  CSRF_FAILED: 'Request rejected. Reload the page and try again.',
  WIDGET_ORIGIN_NOT_ALLOWED: 'This site is not allowed to load the chat widget.',
  INVITATION_INVALID: 'This invitation is no longer valid.',

  NOT_FOUND: 'Not found.',
  VALIDATION_FAILED: 'Some fields need attention.',
  SLUG_TAKEN: 'That identifier is already in use.',
  INVALID_TRANSITION: 'That status change is not allowed.',
  STALE_WRITE: 'This changed since you loaded it. Refresh and try again.',
  LAST_ADMIN: 'A workspace must keep at least one Admin.',
  CATEGORY_NOT_EMPTY: 'Move or delete the articles in this category first.',
  PAYLOAD_TOO_LARGE: 'That request is too large.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',

  WEBHOOK_SIGNATURE_INVALID: 'Webhook signature verification failed.',
  WEBHOOK_RECIPIENT_UNKNOWN: 'Accepted.',
  EMAIL_SEND_FAILED: 'The email could not be sent.',
  AI_BELOW_THRESHOLD: 'This conversation is too short to summarize.',
  AI_UNAVAILABLE: 'AI summaries are unavailable right now.',
  AI_INVALID_OUTPUT: 'The summary could not be generated. Try again.',
  AI_COOLDOWN: 'A summary was just generated. Try again in a moment.',
  DOMAIN_INVALID: 'That hostname cannot be used.',
  DOMAIN_VERIFICATION_FAILED: 'The DNS records could not be verified.',
  INTERNAL: 'Something went wrong on our side.',
};

/** Per-field validation messages, keyed by the field path Zod reports. */
export type FieldErrors = Record<string, string>;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    fieldErrors?: FieldErrors;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
}
