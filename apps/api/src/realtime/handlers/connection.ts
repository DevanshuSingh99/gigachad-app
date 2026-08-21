import { conversationRoom, REALTIME, type PresenceUpdatePayload, type TypingPayload } from '@gigachad/shared';

import { logger } from '../../lib/logger';
import {
  addPresenceSocket,
  listOnline,
  listTyping,
  refreshPresenceSocket,
  removePresenceSocket,
} from '../presence';
import { joinConversationRoom, joinWorkspaceRoom } from '../rooms';
import type { EnsureSubscribed, IoServer, IoSocket } from '../types';
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

    void joinWorkspaceRoom(socket);

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

    const snapshotRoom = async (conversationId: string) => {
      const at = new Date().toISOString();
      const [already, typing] = await Promise.all([
        listOnline(workspaceId, conversationId),
        listTyping(workspaceId, conversationId),
      ]);
      for (const p of already) {
        socket.emit('presence:update', {
          conversationId,
          participantId: p.participantId,
          participantType: p.participantType,
          status: 'ONLINE',
          at,
        });
      }
      for (const p of typing) {
        if (p.participantId === participantId) continue;
        const payload: TypingPayload = {
          conversationId,
          participantId: p.participantId,
          participantType: p.participantType,
        };
        socket.emit('typing:start', payload);
      }
    };

    const ensureSubscribed: EnsureSubscribed = async (conversationId) => {
      // Claimed synchronously, before the first await, so two events for the
      // same conversationId racing this function (e.g. typing:start and
      // message:send arriving back to back) can't both observe an empty
      // `subscribed` and both run snapshotRoom below, double-firing the
      // initial presence/typing snapshot to this socket.
      const firstOnThisSocket = !subscribed.has(conversationId);
      subscribed.add(conversationId);

      const joined = await joinConversationRoom(socket, conversationId);
      if (!joined) {
        if (firstOnThisSocket) subscribed.delete(conversationId);
        return false;
      }

      const { entered } = await addPresenceSocket(
        workspaceId,
        conversationId,
        participantId,
        participantType,
        socket.id,
      );
      if (entered) broadcastPresence(conversationId, 'ONLINE');
      if (firstOnThisSocket) await snapshotRoom(conversationId);
      return true;
    };

    registerConversationHandlers(socket, { ensureSubscribed });
    registerMessageHandlers(socket, { ensureSubscribed });
    registerTypingHandlers(socket, { ensureSubscribed });

    const heartbeat = setInterval(() => {
      for (const conversationId of subscribed) {
        refreshPresenceSocket(workspaceId, conversationId, participantId, participantType, socket.id)
          .then(() => {
            broadcastPresence(conversationId, 'ONLINE');
          })
          .catch((err) => {
            // A Redis outage must not become an unhandled rejection on every
            // socket's heartbeat tick — log and let the next tick retry.
            logger.error({ err, workspaceId, conversationId }, 'presence heartbeat failed');
          });
      }
    }, REALTIME.heartbeatMs);

    socket.on('disconnect', () => {
      clearInterval(heartbeat);
      const conversationIds = [...subscribed];
      void (async () => {
        for (const conversationId of conversationIds) {
          try {
            const { left } = await removePresenceSocket(workspaceId, conversationId, participantId, socket.id);
            if (left) broadcastPresence(conversationId, 'OFFLINE');
          } catch (err) {
            logger.error({ err, workspaceId, conversationId }, 'presence cleanup on disconnect failed');
          }
        }
      })();
      logger.info({ workspaceId }, 'socket disconnected');
    });
  });
}
