import type { AnalyticsOverviewDto, AnalyticsRangeInput } from '@gigachad/shared';

import type { WorkspaceScope } from '../../lib/repo';
import * as dto from './dto';
import * as repo from './repo';
import type { DateRange } from './repo';

const RANGE_DAYS: Record<AnalyticsRangeInput['range'], number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function resolveRange(range: AnalyticsRangeInput['range']): DateRange {
  const end = new Date();
  const start = new Date(end.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function getOverview(
  scope: WorkspaceScope,
  input: AnalyticsRangeInput,
): Promise<AnalyticsOverviewDto> {
  const range = resolveRange(input.range);

  const [
    byChannelRows,
    conversationTrendRows,
    messageTrendRows,
    resolutionStats,
    responseTimeStats,
    busiestHourRows,
    agentPerformanceRows,
  ] = await Promise.all([
    repo.getVolumeByChannel(scope, range),
    repo.getConversationVolumeTrend(scope, range),
    repo.getMessageVolumeTrend(scope, range),
    repo.getResolutionStats(scope, range),
    repo.getFirstResponseStats(scope, range),
    repo.getBusiestHours(scope, range),
    repo.getAgentPerformance(scope, range),
  ]);

  const byChannel = dto.channelCountDto(byChannelRows);
  const createdCount = byChannel.reduce((sum, c) => sum + c.count, 0);

  return dto.overviewDto({
    range,
    byChannel,
    volumeTrend: dto.volumeTrendDto(conversationTrendRows, messageTrendRows),
    resolution: { ...resolutionStats, createdCount },
    responseTime: responseTimeStats,
    busiestHours: dto.busiestHoursDto(busiestHourRows),
    agentPerformance: dto.agentPerformanceDto(agentPerformanceRows),
  });
}
