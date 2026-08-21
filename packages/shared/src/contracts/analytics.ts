import { z } from 'zod';

/**
 * Admin-only Analytics Dashboard contracts — shared between the API and the
 * dashboard client. All figures are computed over the selected range; nothing
 * here is cached or precomputed (docs/09-analytics.md).
 */

export const analyticsRangeInput = z.object({
  range: z.enum(['7d', '30d', '90d']).default('7d'),
});
export type AnalyticsRangeInput = z.infer<typeof analyticsRangeInput>;

export interface AnalyticsChannelCountDto {
  channel: 'CHAT' | 'EMAIL';
  count: number;
}

export interface AnalyticsVolumeTrendPointDto {
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: string;
  conversations: number;
  messages: number;
}

export interface AnalyticsBusiestHourDto {
  /** 0-23, UTC — the workspace has no stored timezone to localize against. */
  hour: number;
  count: number;
}

export interface AnalyticsAgentPerformanceDto {
  userId: string;
  name: string;
  conversationsHandled: number;
  resolvedCount: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}

export interface AnalyticsOverviewDto {
  range: { start: string; end: string };
  volume: {
    total: number;
    byChannel: AnalyticsChannelCountDto[];
  };
  volumeTrend: AnalyticsVolumeTrendPointDto[];
  resolution: {
    resolvedCount: number;
    /** Resolved-in-range ÷ created-in-range, 0-1. */
    resolutionRate: number;
    avgResolutionMinutes: number | null;
    medianResolutionMinutes: number | null;
  };
  responseTime: {
    avgFirstResponseMinutes: number | null;
    medianFirstResponseMinutes: number | null;
  };
  busiestHours: AnalyticsBusiestHourDto[];
  agentPerformance: AnalyticsAgentPerformanceDto[];
}
