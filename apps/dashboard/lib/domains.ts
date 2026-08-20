'use client';

import type { AddDomainInput, DomainDto } from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';

const domainsKey = (workspaceId: string) =>
  ['workspace', workspaceId, 'domains'] as const;

export function useDomains(workspaceId: string | undefined) {
  return useQuery({
    queryKey: domainsKey(workspaceId ?? 'none'),
    queryFn: () => apiFetch<DomainDto[]>(`/api/v1/workspaces/${workspaceId}/domains`),
    enabled: Boolean(workspaceId),
  });
}

export function useAddDomain(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDomainInput) =>
      apiFetch<DomainDto>(`/api/v1/workspaces/${workspaceId}/domains`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: domainsKey(workspaceId) });
    },
  });
}

export function useVerifyDomain(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) =>
      apiFetch<DomainDto>(
        `/api/v1/workspaces/${workspaceId}/domains/${domainId}/verify`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: domainsKey(workspaceId) });
    },
  });
}

export function useDeleteDomain(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) =>
      apiFetch<void>(`/api/v1/workspaces/${workspaceId}/domains/${domainId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: domainsKey(workspaceId) });
    },
  });
}
