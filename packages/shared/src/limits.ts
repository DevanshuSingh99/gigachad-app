/**
 * Caps, timeouts, and rate limits. Mirrors docs/16-errors-and-limits.md, which is
 * the single source of truth for these numbers; realtime timings come from
 * docs/06-realtime.md and AI bounds from docs/08-ai.md.
 *
 * They live in the shared package so the dashboard validates against the same
 * numbers the API enforces instead of a second copy that drifts.
 */

export const CAPS = {
  /** JSON request body. */
  jsonBodyBytes: 256 * 1024,
  /** Inbound email webhook payload — larger because real mail is larger. */
  inboundEmailBytes: 2 * 1024 * 1024,
  /** Message body text. */
  messageTextChars: 8_000,
  /** Sanitized article HTML. */
  articleHtmlBytes: 200 * 1024,
  /** Search query string. */
  searchQueryChars: 200,
  /** Cursor page size. */
  pageSizeDefault: 25,
  pageSizeMax: 100,
  /** Canned response fields. */
  cannedResponseNameChars: 100,
  cannedResponseContentChars: 8_000,
  cannedResponseShortcutChars: 50,
} as const;

export const TIMEOUTS = {
  httpHandlerMs: 15_000,
  llmRequestMs: 30_000,
  llmRetries: 2,
  emailProviderMs: 15_000,
  emailRetries: 3,
  dnsResolutionMs: 5_000,
  dbStatementAppMs: 10_000,
  dbStatementWorkerMs: 30_000,
} as const;

export const LIFETIMES = {
  /** Sliding. */
  sessionDays: 30,
  widgetSessionHours: 24,
  invitationDays: 7,
  idempotencyKeyHours: 24,
} as const;

export const REALTIME = {
  heartbeatMs: 20_000,
  presenceTtlMs: 30_000,
  typingTtlMs: 5_000,
  reconnectMinMs: 500,
  reconnectMaxMs: 8_000,
  /** `conversation:sync` message cap; beyond this the client refetches over HTTP. */
  syncMessageCap: 200,
} as const;

export const AI = {
  /** Default threshold; overridable per workspace via settings_json.aiSummaryMinMessages. */
  minMessages: 6,
  contextMessages: 30,
  perMessageChars: 1_500,
  totalContextTokens: 8_000,
  cooldownSeconds: 60,
  errorCooldownSeconds: 120,
  dailyPerWorkspace: 200,
  /**
   * A QUEUED row older than this is treated as abandoned (worker skip, crash,
   * or exhausted retries that never wrote ERROR). Sized above 3 BullMQ attempts
   * of a 30s LLM call with one schema retry, plus exponential backoff.
   */
  queuedStaleSeconds: 240,
} as const;

/**
 * Rate limits, keyed in Redis with a sliding window. `key` names what the window
 * is counted against — never widen it without re-reading docs/16-errors-and-limits.md.
 * Every 429 carries `Retry-After`.
 */
export const RATE_LIMITS = {
  loginPerIp: { limit: 10, windowSeconds: 15 * 60, key: 'ip' },
  loginPerEmail: { limit: 5, windowSeconds: 15 * 60, key: 'email' },
  signupPerIp: { limit: 5, windowSeconds: 60 * 60, key: 'ip' },
  invitationCreate: { limit: 30, windowSeconds: 60 * 60, key: 'workspace' },
  invitationAccept: { limit: 10, windowSeconds: 60 * 60, key: 'ip' },
  widgetSessionCreate: { limit: 20, windowSeconds: 60 * 60, key: 'ip+widgetKey' },
  widgetMessageSend: { limit: 20, windowSeconds: 60, key: 'widgetSession' },
  socketMessageSend: { limit: 30, windowSeconds: 60, key: 'socket' },
  socketTyping: { limit: 40, windowSeconds: 10, key: 'socket' },
  kbSuggestions: { limit: 60, windowSeconds: 60, key: 'widgetSession' },
  publicKbSearch: { limit: 60, windowSeconds: 60, key: 'ip' },
  aiSummaryPerConversation: { limit: 5, windowSeconds: 5 * 60, key: 'conversation' },
  aiSummaryPerWorkspaceDay: { limit: 200, windowSeconds: 24 * 60 * 60, key: 'workspace' },
  domainVerify: { limit: 10, windowSeconds: 60 * 60, key: 'workspace' },
  // Not a security control — requireAdmin is. This just bounds how often the
  // heavy multi-query aggregate behind /analytics/overview can be re-run
  // (e.g. a range-toggle double-click) on the single-vCPU box.
  analyticsRead: { limit: 30, windowSeconds: 60, key: 'workspace' },
  // Keyed by caller IP (Caddy's container IP in production), not by the
  // attacker-controlled `domain` query param — see tlsAsk.ts. Paired with a
  // generous global backstop, same shape as loginPerIp/loginPerEmail below.
  tlsAsk: { limit: 5, windowSeconds: 2 * 60, key: 'ip' },
  tlsAskGlobal: { limit: 60, windowSeconds: 2 * 60, key: 'global' },
  inboundWebhook: { limit: 600, windowSeconds: 60, key: 'global' },
  // Layered on top of the global cap above (same pair shape as
  // tlsAsk/tlsAskGlobal), so one attacker IP cannot exhaust the shared budget
  // that legitimate provider traffic needs. Not documented with an exact
  // number, so this uses 1/5th of the global cap as a reasonable default.
  inboundWebhookPerIp: { limit: 120, windowSeconds: 60, key: 'ip' },
} as const satisfies Record<string, { limit: number; windowSeconds: number; key: string }>;

export type RateLimitName = keyof typeof RATE_LIMITS;
