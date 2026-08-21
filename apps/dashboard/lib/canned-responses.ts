'use client';

import type {
  CannedResponseDto,
  CannedResponseListQuery,
  CreateCannedResponseInput,
  PatchCannedResponseInput,
} from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';

const base = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/canned-responses`;

export const cannedResponsesKey = (workspaceId: string, query?: Partial<CannedResponseListQuery>) =>
  ['workspace', workspaceId, 'canned-responses', query ?? {}] as const;

export function useCannedResponses(
  workspaceId: string | undefined,
  query: Partial<CannedResponseListQuery> = {},
) {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.tag) params.set('tag', query.tag);
  const qs = params.toString();

  return useQuery({
    queryKey: cannedResponsesKey(workspaceId ?? 'none', query),
    queryFn: () =>
      apiFetch<CannedResponseDto[]>(`${base(workspaceId!)}${qs ? `?${qs}` : ''}`),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateCannedResponse(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCannedResponseInput) =>
      apiFetch<CannedResponseDto>(base(workspaceId!), { method: 'POST', body: input }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: cannedResponsesKey(workspaceId) });
    },
  });
}

export function usePatchCannedResponse(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: PatchCannedResponseInput & { id: string }) =>
      apiFetch<CannedResponseDto>(`${base(workspaceId!)}/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: cannedResponsesKey(workspaceId) });
    },
  });
}

export function useDeleteCannedResponse(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${base(workspaceId!)}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: cannedResponsesKey(workspaceId) });
    },
  });
}
