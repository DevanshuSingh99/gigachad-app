import type { SummaryDisplayState, SummaryDto } from '@gigachad/shared';

export interface SummaryRow {
  id: string;
  conversationId: string;
  workspaceId: string;
  summaryText: string | null;
  userWants: string | null;
  tried: string | null;
  currentStatus: string | null;
  sourceMessageCount: number | null;
  state: string;
  errorCode: string | null;
  model: string | null;
  promptVersion: string | null;
  updatedAt: Date;
}

/**
 * Produces the DTO the dashboard renders.
 *
 * `conversationMessageCount` lets us compute STALE:
 * if the conversation has more messages than the summary was built from,
 * the summary is outdated. No extra write is needed — staleness is derived.
 */
export function summaryDto(
  row: SummaryRow,
  conversationMessageCount: number,
): SummaryDto {
  let displayState: SummaryDisplayState;

  if (row.state === 'QUEUED') {
    displayState = 'queued';
  } else if (row.state === 'ERROR') {
    displayState = 'error';
  } else {
    // READY — check staleness
    const isStale =
      row.sourceMessageCount !== null &&
      conversationMessageCount > row.sourceMessageCount;
    displayState = isStale ? 'stale' : 'ready';
  }

  return {
    summaryText: row.summaryText,
    userWants: row.userWants,
    tried: row.tried,
    currentStatus: row.currentStatus,
    state: displayState,
    updatedAt: row.updatedAt.toISOString(),
    model: row.model,
    errorCode: row.errorCode,
  };
}

/** For a conversation that has never had a summary triggered and is genuinely below threshold. */
export function belowThresholdDto(): SummaryDto {
  return {
    summaryText: null,
    userWants: null,
    tried: null,
    currentStatus: null,
    state: 'below_threshold',
    updatedAt: null,
    model: null,
    errorCode: null,
  };
}

/** For a conversation that meets the threshold but has never had a summary generated. */
export function eligibleDto(): SummaryDto {
  return {
    summaryText: null,
    userWants: null,
    tried: null,
    currentStatus: null,
    state: 'eligible',
    updatedAt: null,
    model: null,
    errorCode: null,
  };
}
