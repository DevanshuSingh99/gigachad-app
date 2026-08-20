'use client';

import type {
  ConversationDto,
  ConversationListQuery,
  ContactDetailDto,
  CreateMessageInput,
  MessageDto,
  Page,
  PatchConversationInput,
} from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';

/**
 * Inbox data hooks.
 *
 * Query keys are namespaced by workspace (docs/17-caching.md) so switching
 * workspaces can never surface a previous workspace's cached list. Phase D wires
 * these same keys up to Socket.IO invalidation; for now, mutations invalidate
 * directly since there is no realtime signal yet.
 */

export interface ConversationFilters {
  channel?: 'CHAT' | 'EMAIL';
  status?: 'OPEN' | 'SNOOZED' | 'RESOLVED';
  assigneeId?: 'unassigned' | string;
}

export const conversationsKey = (workspaceId: string, filters: ConversationFilters) =>
  ['workspace', workspaceId, 'conversations', filters] as const;

export const conversationKey = (workspaceId: string, conversationId: string) =>
  ['workspace', workspaceId, 'conversation', conversationId] as const;

export const messagesKey = (workspaceId: string, conversationId: string) =>
  ['workspace', workspaceId, 'conversation', conversationId, 'messages'] as const;

function query(filters: ConversationFilters): string {
  const params = new URLSearchParams();
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.status) params.set('status', filters.status);
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useConversations(workspaceId: string | undefined, filters: ConversationFilters) {
  return useQuery({
    queryKey: conversationsKey(workspaceId ?? 'none', filters),
    queryFn: () =>
      apiFetch<Page<ConversationDto>>(
        `/api/v1/workspaces/${workspaceId}/conversations${query(filters)}`,
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useConversation(workspaceId: string | undefined, conversationId: string | null) {
  return useQuery({
    queryKey: conversationKey(workspaceId ?? 'none', conversationId ?? 'none'),
    queryFn: () =>
      apiFetch<ConversationDto>(`/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`),
    enabled: Boolean(workspaceId && conversationId),
  });
}

export function useMessages(workspaceId: string | undefined, conversationId: string | null) {
  return useQuery({
    queryKey: messagesKey(workspaceId ?? 'none', conversationId ?? 'none'),
    queryFn: () =>
      apiFetch<Page<MessageDto>>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages?limit=100`,
      ),
    enabled: Boolean(workspaceId && conversationId),
  });
}

/** A member's own workspace list — used to populate the assignee filter/select. */
export function useContact(workspaceId: string | undefined, contactId: string | null) {
  return useQuery({
    queryKey: ['workspace', workspaceId ?? 'none', 'contact', contactId ?? 'none'],
    queryFn: () =>
      apiFetch<ContactDetailDto>(`/api/v1/workspaces/${workspaceId}/contacts/${contactId}`),
    enabled: Boolean(workspaceId && contactId),
  });
}

function invalidateConversation(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  conversationId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'conversations'] });
  void queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, conversationId) });
}

export function useSendMessage(workspaceId: string | undefined, conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMessageInput) =>
      apiFetch<MessageDto>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      if (workspaceId && conversationId) {
        void queryClient.invalidateQueries({ queryKey: messagesKey(workspaceId, conversationId) });
        invalidateConversation(queryClient, workspaceId, conversationId);
      }
    },
  });
}

export function usePatchConversation(workspaceId: string | undefined, conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PatchConversationInput) =>
      apiFetch<ConversationDto>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: () => {
      if (workspaceId && conversationId) invalidateConversation(queryClient, workspaceId, conversationId);
    },
  });
}

/** Generates a client message id for optimistic sends and idempotent retries. */
export function newClientMessageId(): string {
  return `cm_${crypto.randomUUID()}`;
}
