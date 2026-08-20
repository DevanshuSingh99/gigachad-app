/**
 * AI summary contracts — shared between the API and the dashboard client.
 */

/**
 * Client-facing summary state. Six values:
 *   - `below_threshold` — not enough messages yet (not a DB state, computed client-side)
 *   - `eligible`        — enough messages, but no summary has ever been generated
 *   - `queued`          — job is in flight
 *   - `ready`           — fresh summary
 *   - `stale`           — summary exists but new messages arrived since it was generated
 *   - `error`           — last attempt failed; may still carry the previous summary
 */
export type SummaryDisplayState =
  | 'below_threshold'
  | 'eligible'
  | 'queued'
  | 'ready'
  | 'stale'
  | 'error';

export interface SummaryDto {
  /** Null when no summary has ever completed for this conversation. */
  summaryText: string | null;
  userWants: string | null;
  tried: string | null;
  currentStatus: string | null;
  state: SummaryDisplayState;
  /** ISO timestamp of the last update, null when no row exists. */
  updatedAt: string | null;
  /** Model that produced the last completed summary. */
  model: string | null;
  /** Human-readable error reason, present when state is 'error'. */
  errorCode: string | null;
}

export interface SummaryTriggerDto {
  state: 'queued';
  jobId: string;
}
