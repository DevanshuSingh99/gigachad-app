'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { invalidateSummary } from '@/lib/ai';
import { conversationKey, messagesKey } from '@/lib/inbox';
import { getSocket } from '@/lib/socket';

/**
 * Drives TanStack Query invalidation from socket events.
 *
 * Realtime already delivers the truth, so the socket's only job is to say the
 * cache is out of date — not to become a second store the UI reads from
 * directly. Pushing payloads into component state instead would leave two
 * sources of truth for the same data, and they would drift the moment either
 * path missed an event (docs/17-caching.md). Mounted once per active workspace,
 * inside AppShell, so it is live on every authenticated screen rather than only
 * the inbox.
 */
export function RealtimeProvider({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket(workspaceId);

    const invalidateConversations = () =>
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'conversations'] });

    const onMessageNew = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: messagesKey(workspaceId, payload.conversationId) });
      invalidateConversations();
    };
    // A message already in the list changed (e.g. an outbound email's delivery
    // status) — only the messages query needs to refetch, not the conversation
    // list, since nothing about the conversation summary itself changed.
    const onMessageUpdated = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: messagesKey(workspaceId, payload.conversationId) });
    };
    const onConversationUpdated = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, payload.conversationId) });
      invalidateConversations();
    };
    const onMessageRead = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, payload.conversationId) });
    };
    const onSummaryUpdated = (payload: { conversationId: string }) => {
      invalidateSummary(queryClient, workspaceId, payload.conversationId);
    };
    const onConnect = () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    };

    socket.on('message:new', onMessageNew);
    socket.on('message:updated', onMessageUpdated);
    socket.on('conversation:updated', onConversationUpdated);
    socket.on('message:read', onMessageRead);
    socket.on('summary:updated', onSummaryUpdated);
    socket.on('conversation:sync', onMessageNew);
    socket.on('connect', onConnect);

    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('message:updated', onMessageUpdated);
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('message:read', onMessageRead);
      socket.off('summary:updated', onSummaryUpdated);
      socket.off('conversation:sync', onMessageNew);
      socket.off('connect', onConnect);
    };
  }, [workspaceId, queryClient]);

  return null;
}
