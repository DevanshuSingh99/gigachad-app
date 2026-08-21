import type {
  AnalyticsAgentPerformanceDto,
  AnalyticsBusiestHourDto,
  AnalyticsChannelCountDto,
  AnalyticsOverviewDto,
  AnalyticsVolumeTrendPointDto,
} from '@gigachad/shared';

/** One decimal place — good enough for a dashboard tile, and avoids the raw floating-point tail from EPOCH/60 division. */
function roundMinutes(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

export function channelCountDto(rows: Array<{ channel: 'CHAT' | 'EMAIL'; count: number }>): AnalyticsChannelCountDto[] {
  return rows.map((r) => ({ channel: r.channel, count: r.count }));
}

export function volumeTrendDto(
  conversationRows: Array<{ date: string; count: number }>,
  messageRows: Array<{ date: string; count: number }>,
): AnalyticsVolumeTrendPointDto[] {
  const byDate = new Map<string, { conversations: number; messages: number }>();
  for (const row of conversationRows) {
    byDate.set(row.date, { conversations: row.count, messages: byDate.get(row.date)?.messages ?? 0 });
  }
  for (const row of messageRows) {
    byDate.set(row.date, { conversations: byDate.get(row.date)?.conversations ?? 0, messages: row.count });
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, counts]) => ({ date, ...counts }));
}

export function busiestHoursDto(rows: Array<{ hour: number; count: number }>): AnalyticsBusiestHourDto[] {
  // Fill every hour 0-23 so the chart never has a gap for a quiet hour.
  const byHour = new Map(rows.map((r) => [r.hour, r.count]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) ?? 0 }));
}

export function agentPerformanceDto(
  rows: Array<{
    userId: string;
    name: string;
    conversationsHandled: number;
    resolvedCount: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
  }>,
): AnalyticsAgentPerformanceDto[] {
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    conversationsHandled: r.conversationsHandled,
    resolvedCount: r.resolvedCount,
    avgFirstResponseMinutes: roundMinutes(r.avgFirstResponseMinutes),
    avgResolutionMinutes: roundMinutes(r.avgResolutionMinutes),
  }));
}

export function overviewDto(input: {
  range: { start: Date; end: Date };
  byChannel: AnalyticsChannelCountDto[];
  volumeTrend: AnalyticsVolumeTrendPointDto[];
  resolution: { resolvedCount: number; createdCount: number; avgMinutes: number | null; medianMinutes: number | null };
  responseTime: { avgMinutes: number | null; medianMinutes: number | null };
  busiestHours: AnalyticsBusiestHourDto[];
  agentPerformance: AnalyticsAgentPerformanceDto[];
}): AnalyticsOverviewDto {
  const total = input.byChannel.reduce((sum, c) => sum + c.count, 0);
  return {
    range: { start: input.range.start.toISOString(), end: input.range.end.toISOString() },
    volume: { total, byChannel: input.byChannel },
    volumeTrend: input.volumeTrend,
    resolution: {
      resolvedCount: input.resolution.resolvedCount,
      resolutionRate: input.resolution.createdCount > 0 ? input.resolution.resolvedCount / input.resolution.createdCount : 0,
      avgResolutionMinutes: roundMinutes(input.resolution.avgMinutes),
      medianResolutionMinutes: roundMinutes(input.resolution.medianMinutes),
    },
    responseTime: {
      avgFirstResponseMinutes: roundMinutes(input.responseTime.avgMinutes),
      medianFirstResponseMinutes: roundMinutes(input.responseTime.medianMinutes),
    },
    busiestHours: input.busiestHours,
    agentPerformance: input.agentPerformance,
  };
}
