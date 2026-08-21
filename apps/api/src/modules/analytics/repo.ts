import type { Channel } from '@gigachad/shared';

import { db } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

/**
 * All-read repo for the Analytics Dashboard. No transactions, no `unscoped()`
 * — every query is a plain aggregate scoped to one workspace.
 *
 * `groupBy`/`aggregate` calls are still checked by the tenant-scope Prisma
 * extension in db.ts (`workspaceId` must be in `where`), same as every other
 * repo. Raw SQL (`$queryRaw`, needed for `PERCENTILE_CONT`/`EXTRACT(HOUR ...)`/
 * `date_trunc`, none of which the query builder expresses) is NOT intercepted
 * by that extension, so every one of these manually filters on
 * `workspace_id = $1` — do not copy one of these without that predicate.
 */

export interface DateRange {
  start: Date;
  end: Date;
}

export async function getVolumeByChannel(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<Array<{ channel: Channel; count: number }>> {
  const rows = await db.conversation.groupBy({
    by: ['channel'],
    where: { workspaceId: scope.workspaceId, createdAt: { gte: range.start, lte: range.end } },
    _count: { _all: true },
  });
  return rows.map((r) => ({ channel: r.channel, count: r._count._all }));
}

export async function getConversationVolumeTrend(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<Array<{ date: string; count: number }>> {
  return db.$queryRaw<Array<{ date: string; count: number }>>`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
    FROM conversations
    WHERE workspace_id = ${scope.workspaceId}::uuid AND created_at BETWEEN ${range.start} AND ${range.end}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function getMessageVolumeTrend(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<Array<{ date: string; count: number }>> {
  return db.$queryRaw<Array<{ date: string; count: number }>>`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
    FROM messages
    WHERE workspace_id = ${scope.workspaceId}::uuid AND created_at BETWEEN ${range.start} AND ${range.end}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function getResolutionStats(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<{ resolvedCount: number; avgMinutes: number | null; medianMinutes: number | null }> {
  const rows = await db.$queryRaw<
    Array<{ resolvedCount: number; avgMinutes: number | null; medianMinutes: number | null }>
  >`
    SELECT
      COUNT(*)::int AS "resolvedCount",
      (AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60))::float AS "avgMinutes",
      (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60))::float AS "medianMinutes"
    FROM conversations
    WHERE workspace_id = ${scope.workspaceId}::uuid
      AND resolved_at IS NOT NULL
      AND resolved_at BETWEEN ${range.start} AND ${range.end}
  `;
  return rows[0] ?? { resolvedCount: 0, avgMinutes: null, medianMinutes: null };
}

export async function getFirstResponseStats(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<{ avgMinutes: number | null; medianMinutes: number | null }> {
  const rows = await db.$queryRaw<Array<{ avgMinutes: number | null; medianMinutes: number | null }>>`
    SELECT
      (AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60))::float AS "avgMinutes",
      (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60))::float AS "medianMinutes"
    FROM conversations
    WHERE workspace_id = ${scope.workspaceId}::uuid
      AND first_response_at IS NOT NULL
      AND first_response_at BETWEEN ${range.start} AND ${range.end}
  `;
  return rows[0] ?? { avgMinutes: null, medianMinutes: null };
}

export async function getBusiestHours(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<Array<{ hour: number; count: number }>> {
  return db.$queryRaw<Array<{ hour: number; count: number }>>`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count
    FROM messages
    WHERE workspace_id = ${scope.workspaceId}::uuid AND created_at BETWEEN ${range.start} AND ${range.end}
    GROUP BY 1
    ORDER BY 1
  `;
}

/**
 * Grouped by the conversation's CURRENT assignee (`conversations.assignee_id`),
 * not the full `conversation_assignments` history — a conversation reassigned
 * mid-range counts entirely toward whoever holds it now. Simpler than
 * reconciling overlapping assignment windows against the date range, and the
 * only misattribution it causes is on reassignment, not on every conversation.
 */
export async function getAgentPerformance(
  scope: WorkspaceScope,
  range: DateRange,
): Promise<
  Array<{
    userId: string;
    name: string;
    conversationsHandled: number;
    resolvedCount: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
  }>
> {
  return db.$queryRaw<
    Array<{
      userId: string;
      name: string;
      conversationsHandled: number;
      resolvedCount: number;
      avgFirstResponseMinutes: number | null;
      avgResolutionMinutes: number | null;
    }>
  >`
    SELECT
      u.id AS "userId",
      u.name AS "name",
      COUNT(*)::int AS "conversationsHandled",
      COUNT(*) FILTER (WHERE c.resolved_at IS NOT NULL)::int AS "resolvedCount",
      (AVG(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at)) / 60) FILTER (WHERE c.first_response_at IS NOT NULL))::float AS "avgFirstResponseMinutes",
      (AVG(EXTRACT(EPOCH FROM (c.resolved_at - c.created_at)) / 60) FILTER (WHERE c.resolved_at IS NOT NULL))::float AS "avgResolutionMinutes"
    FROM conversations c
    JOIN workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.user_id = c.assignee_id AND wm.status = 'ACTIVE'
    JOIN users u ON u.id = c.assignee_id
    WHERE c.workspace_id = ${scope.workspaceId}::uuid
      AND c.assignee_id IS NOT NULL
      AND c.created_at BETWEEN ${range.start} AND ${range.end}
    GROUP BY u.id, u.name
    ORDER BY "conversationsHandled" DESC
  `;
}
