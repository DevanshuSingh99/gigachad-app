'use client';

import type { CreateEmbedTokenInput, EmbedTokenDto } from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';

const embedTokensKey = (workspaceId: string) =>
  ['workspace', workspaceId, 'embed-tokens'] as const;

export function useEmbedTokens(workspaceId: string | undefined) {
  return useQuery({
    queryKey: embedTokensKey(workspaceId ?? 'none'),
    queryFn: () => apiFetch<EmbedTokenDto[]>(`/api/v1/workspaces/${workspaceId}/embed-tokens`),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateEmbedToken(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmbedTokenInput) =>
      apiFetch<EmbedTokenDto>(`/api/v1/workspaces/${workspaceId}/embed-tokens`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: embedTokensKey(workspaceId) });
    },
  });
}

export function useRevokeEmbedToken(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiFetch<EmbedTokenDto>(`/api/v1/workspaces/${workspaceId}/embed-tokens/${tokenId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: embedTokensKey(workspaceId) });
    },
  });
}
