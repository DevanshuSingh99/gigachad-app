import { conversationRoom, REALTIME, type PresenceUpdatePayload } from '@gigachad/shared';

import { logger } from '../../lib/logger';
import { markOffline, markOnline, refreshOnline } from '../presence';
import { joinWorkspaceRoom } from '../rooms';
import type { IoServer, IoSocket } from '../types';
import { registerConversationHandlers } from './conversation';
import { registerMessageHandlers } from './message';
import { registerTypingHandlers } from './typing';

function participantOf(socket: IoSocket): { id: string; type: 'AGENT' | 'CUSTOMER' } {
  const p = socket.data.principal;
  return p.actorType === 'AGENT' ? { id: p.userId, type: 'AGENT' } : { id: p.contactId, type: 'CUSTOMER' };
}

/**
 * Per-connection wiring. One thing lives here that does not belong in any single
 * handler file: presence's heartbeat and cleanup, because both need the full set
 * of conversations this socket is subscribed to, which only this scope tracks.
 */
export function registerConnectionHandlers(io: IoServer): void {
  io.on('connection', (socket) => {
    const { workspaceId } = socket.data.principal;
    logger.info({ workspaceId, actorType: socket.data.principal.actorType }, 'socket connected');

    joinWorkspaceRoom(socket);

    const subscribed = new Set<string>();
    const { id: participantId, type: participantType } = participantOf(socket);

    const broadcastPresence = (conversationId: string, status: 'ONLINE' | 'OFFLINE') => {
      const payload: PresenceUpdatePayload = {
        conversationId,
        participantId,
        participantType,
        status,
        at: new Date().toISOString(),
      };
      socket.to(conversationRoom(workspaceId, conversationId)).emit('presence:update', payload);
    };

    registerConversationHandlers(socket, {
      onSubscribed: async (conversationId) => {
        subscribed.add(conversationId);
        await markOnline(workspaceId, conversationId, participantId);
        broadcastPresence(conversationId, 'ONLINE');
      },
    });
    registerMessageHandlers(socket);
    registerTypingHandlers(socket);

    // The safety-net TTL (REALTIME.presenceTtlMs) only holds if something keeps
    // sliding it forward while the socket is genuinely still connected — this is
    // that renewal, not a liveness probe of its own (engine.io already pings the
    // transport itself).
    const heartbeat = setInterval(() => {
      for (const conversationId of subscribed) {
        void refreshOnline(workspaceId, conversationId, participantId);
      }
    }, REALTIME.heartbeatMs);

    socket.on('disconnect', () => {
      clearInterval(heartbeat);
      for (const conversationId of subscribed) {
        void markOffline(workspaceId, conversationId, participantId);
        broadcastPresence(conversationId, 'OFFLINE');
      }
      logger.info({ workspaceId }, 'socket disconnected');
    });
  });
}
