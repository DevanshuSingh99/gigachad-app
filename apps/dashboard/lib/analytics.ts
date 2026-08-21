'use client';

import type { AnalyticsOverviewDto, AnalyticsRangeInput } from '@gigachad/shared';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from './api';

export type AnalyticsRange = AnalyticsRangeInput['range'];

const analyticsKey = (workspaceId: string, range: AnalyticsRange) =>
  ['workspace', workspaceId, 'analytics', range] as const;

export function useAnalyticsOverview(workspaceId: string | undefined, range: AnalyticsRange) {
  return useQuery({
    queryKey: analyticsKey(workspaceId ?? 'none', range),
    queryFn: () =>
      apiFetch<AnalyticsOverviewDto>(
        `/api/v1/workspaces/${workspaceId}/analytics/overview?range=${range}`,
      ),
    enabled: Boolean(workspaceId),
  });
}
