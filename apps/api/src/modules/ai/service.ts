import type { SummaryDto, SummaryTriggerDto } from '@gigachad/shared';
import { AI } from '@gigachad/shared';

import { db } from '../../db';
import { env } from '../../env';
import { AppError, notFound } from '../../lib/errors';
import { aiSummaryQueue } from '../../lib/ai/queue';
import { consume } from '../../lib/rateLimit';
import type { WorkspaceScope } from '../../lib/repo';
import { parseSettings } from '../workspaces/dto';
import { belowThresholdDto, eligibleDto, summaryDto } from './dto';
import * as repo from './repo';

// ─── GET /summary ─────────────────────────────────────────────────────────────

/**
 * Returns the current summary state for the dashboard panel.
 *
 * Staleness is computed here — no DB write needed (docs/08-ai.md):
 * if the conversation has more messages than the summary was built from,
 * the summary is STALE.
 */
export async function getSummary(
  scope: WorkspaceScope,
  conversationId: string,
): Promise<SummaryDto> {
  // ── Existence / workspace scope ───────────────────────────────────────────
  // Must run before the AI-availability short-circuit below: a foreign or
  // nonexistent conversation always 404s, whether or not AI is enabled
  // (invariant 4).
  const [stats, workspace] = await Promise.all([
    repo.loadConversationStats(scope.workspaceId, conversationId),
    db.workspace.findFirst({
      where: { id: scope.workspaceId },
      select: { settingsJson: true },
    }),
  ]);
  if (!stats) throw notFound('conversation');
  if (!workspace) throw notFound('workspace');

  if (!env.aiEnabled) {
    return {
      summaryText: null,
      userWants: null,
      tried: null,
      currentStatus: null,
      state: 'below_threshold',
      updatedAt: null,
      model: null,
      errorCode: 'AI_UNAVAILABLE',
    };
  }

  const row = await repo.findSummary(scope, conversationId);
  if (!row) {
    // No summary has ever been generated. Distinguish "genuinely below
    // threshold" from "eligible, just never triggered" — the latter is not
    // a false "need more messages" claim (docs/08-ai.md UI states).
    const settings = parseSettings(workspace.settingsJson);
    const minMessages = settings.aiSummaryMinMessages ?? AI.minMessages;
    return stats.messageCount >= minMessages ? eligibleDto() : belowThresholdDto();
  }

  return summaryDto(row, stats.messageCount);
}

// ─── POST /summary ────────────────────────────────────────────────────────────

/**
 * Validates thresholds and cooldown, then enqueues a deduplicated BullMQ job.
 *
 * Guard order (adapted from docs/08-ai.md so cheap/already-loaded checks run
 * before quota-consuming ones — a cooldown-rejected request must not burn the
 * daily quota):
 *   0. Conversation/workspace existence — always checked, AI enabled or not
 *   1. AI unavailable
 *   2. Below message threshold
 *   3. Per-conversation cooldown (60s normal, 120s after error) + Redis bound
 *   4. Per-workspace daily cap
 *   5. Enqueue
 */
export async function triggerSummary(
  scope: WorkspaceScope,
  conversationId: string,
): Promise<SummaryTriggerDto> {
  // ── 0. Existence / workspace scope ────────────────────────────────────────
  // Must run before the AI-availability short-circuit below — a foreign or
  // nonexistent conversation must 404 regardless of whether AI is enabled
  // (invariant 4).
  const [stats, workspace] = await Promise.all([
    repo.loadConversationStats(scope.workspaceId, conversationId),
    db.workspace.findFirst({
      where: { id: scope.workspaceId },
      select: { settingsJson: true },
    }),
  ]);
  if (!stats) throw notFound('conversation');
  if (!workspace) throw notFound('workspace');

  // ── 1. AI availability ────────────────────────────────────────────────────
  if (!env.aiEnabled) {
    throw new AppError('AI_UNAVAILABLE', {
      message: 'AI summaries are not available — OPENAI_API_KEY is not configured.',
    });
  }

  // ── 2. Threshold ──────────────────────────────────────────────────────────
  const settings = parseSettings(workspace.settingsJson);
  const minMessages = settings.aiSummaryMinMessages ?? AI.minMessages;

  if (stats.messageCount < minMessages) {
    throw new AppError('AI_BELOW_THRESHOLD', {
      message: `This conversation needs at least ${minMessages} messages to summarize.`,
    });
  }

  // ── 3. Per-conversation cooldown ──────────────────────────────────────────
  // Runs before the daily cap below: this is a single already-fetched row
  // check, so a rapid double-click during the cooldown window is rejected
  // here without ever touching (and burning) the workspace's daily quota.
  const existing = await repo.findSummary(scope, conversationId);
  if (existing) {
    if (existing.state === 'QUEUED') {
      // Already in flight — idempotent: return the same "queued" state.
      // (This is a descriptive placeholder, not a real BullMQ job id — the
      // job id itself is never persisted or looked up by the client.)
      return { state: 'queued', jobId: `ai-summary:${conversationId}:queued` };
    }

    const cooldownMs =
      existing.state === 'ERROR'
        ? AI.cooldownSeconds * 2 * 1000
        : AI.cooldownSeconds * 1000;

    const elapsed = Date.now() - existing.updatedAt.getTime();
    if (elapsed < cooldownMs) {
      throw new AppError('AI_COOLDOWN', {
        message: 'A summary was just generated. Try again shortly.',
        retryAfterSeconds: Math.ceil((cooldownMs - elapsed) / 1000),
      });
    }
  }

  // Redis-backed per-conversation bound (RATE_LIMITS.aiSummaryPerConversation).
  // The cooldown above already lives in Postgres (the AiSummary row's
  // updatedAt) and survives restarts on its own, but it only bounds the
  // *interval* between generations; this bucket separately bounds the
  // *count* within a rolling window, so it still adds coverage — e.g. it
  // catches a burst pattern the fixed cooldown wouldn't. Consumed only after
  // the cheap checks above pass, so a rejected-by-cooldown click never
  // spends it either.
  const perConversation = await consume('aiSummaryPerConversation', conversationId);
  if (!perConversation.allowed) {
    throw new AppError('RATE_LIMITED', {
      message: 'Too many summary attempts for this conversation. Try again shortly.',
      retryAfterSeconds: perConversation.retryAfterSeconds,
    });
  }

  // ── 4. Per-workspace daily cap ────────────────────────────────────────────
  const dailyCap = await consume('aiSummaryPerWorkspaceDay', scope.workspaceId);
  if (!dailyCap.allowed) {
    throw new AppError('RATE_LIMITED', {
      message: 'Daily AI summary limit reached for this workspace.',
      retryAfterSeconds: dailyCap.retryAfterSeconds,
    });
  }

  // ── 5. Enqueue ────────────────────────────────────────────────────────────
  // Mark QUEUED in DB first so the GET endpoint reflects the in-flight state
  // immediately (before the worker picks up the job).
  await db.$transaction((tx) =>
    repo.upsertSummaryQueued(tx, scope.workspaceId, conversationId),
  );

  // The BullMQ job id must be unique per enqueue attempt, not per
  // conversation: BullMQ keeps completed/failed job records around
  // (removeOnComplete/removeOnFail are counts, not immediate deletion), and
  // re-adding with a stale job id silently no-ops (handleDuplicatedJob) —
  // no worker run, no emit, ever again, for that conversation. The
  // in-flight-duplicate guard is the DB `state === 'QUEUED'` check above,
  // which runs before we ever get here, so the job id no longer needs to
  // double as an application-level dedup key.
  const jobId = `ai-summary:${conversationId}:${Date.now()}`;
  await aiSummaryQueue.add(
    'generate',
    { workspaceId: scope.workspaceId, conversationId },
    { jobId },
  );

  return { state: 'queued', jobId };
}
