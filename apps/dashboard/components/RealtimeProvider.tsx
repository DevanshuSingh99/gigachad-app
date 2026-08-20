'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

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
    const onConversationUpdated = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, payload.conversationId) });
      invalidateConversations();
    };
    const onMessageRead = (payload: { conversationId: string }) => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, payload.conversationId) });
    };

    socket.on('message:new', onMessageNew);
    socket.on('conversation:updated', onConversationUpdated);
    socket.on('message:read', onMessageRead);

    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('message:read', onMessageRead);
    };
  }, [workspaceId, queryClient]);

  return null;
}
