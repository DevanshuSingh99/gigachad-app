'use client';

import type { SummaryDto, SummaryTriggerDto } from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';

export const summaryKey = (workspaceId: string, conversationId: string) =>
  ['workspace', workspaceId, 'conversation', conversationId, 'summary'] as const;

export function useSummary(
  workspaceId: string | undefined,
  conversationId: string | null,
) {
  return useQuery({
    queryKey: summaryKey(workspaceId ?? 'none', conversationId ?? 'none'),
    queryFn: () =>
      apiFetch<SummaryDto>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/summary`,
      ),
    enabled: Boolean(workspaceId && conversationId),
    // Summary state changes via socket; poll only while a job is in flight so
    // a missed `summary:updated` (worker emit used to no-op) cannot leave the
    // panel on "Generating summary…" forever.
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.state === 'queued' ? 2_000 : false),
  });
}

export function useTriggerSummary(
  workspaceId: string | undefined,
  conversationId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<SummaryTriggerDto>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/summary`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      if (workspaceId && conversationId) {
        void queryClient.invalidateQueries({
          queryKey: summaryKey(workspaceId, conversationId),
        });
      }
    },
  });
}

/** Called from the RealtimeProvider when a `summary:updated` socket event arrives. */
export function invalidateSummary(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  conversationId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: summaryKey(workspaceId, conversationId),
  });
}
