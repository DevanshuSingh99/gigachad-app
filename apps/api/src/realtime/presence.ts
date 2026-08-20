import { REALTIME } from '@gigachad/shared';

import { redis } from '../lib/redis';

/**
 * Presence and typing, entirely in Redis with short TTLs — never in process
 * memory, so this survives horizontal scale-out with zero code change (the same
 * reasoning as the Redis-backed Socket.IO adapter in lib/redis.ts). Docs/06-realtime.md:
 * "Presence is best-effort and expires; messages are durable." Losing Redis loses
 * presence, never a message.
 *
 * The TTL is a safety net for an ungraceful disconnect (network drop with no
 * close frame), not the primary offline signal — a clean disconnect deletes the
 * key and broadcasts OFFLINE immediately, per handlers/connection.ts.
 */

function presenceKey(workspaceId: string, conversationId: string, participantId: string): string {
  return `presence:${workspaceId}:${conversationId}:${participantId}`;
}

function typingKey(workspaceId: string, conversationId: string, participantId: string): string {
  return `typing:${workspaceId}:${conversationId}:${participantId}`;
}

export async function markOnline(workspaceId: string, conversationId: string, participantId: string): Promise<void> {
  await redis.set(presenceKey(workspaceId, conversationId, participantId), '1', 'PX', REALTIME.presenceTtlMs);
}

/** Called on the heartbeat interval while a socket stays subscribed — slides the TTL forward. */
export async function refreshOnline(workspaceId: string, conversationId: string, participantId: string): Promise<void> {
  await markOnline(workspaceId, conversationId, participantId);
}

export async function markOffline(workspaceId: string, conversationId: string, participantId: string): Promise<void> {
  await redis.del(presenceKey(workspaceId, conversationId, participantId));
}

export async function markTyping(workspaceId: string, conversationId: string, participantId: string): Promise<void> {
  await redis.set(typingKey(workspaceId, conversationId, participantId), '1', 'PX', REALTIME.typingTtlMs);
}

export async function clearTyping(workspaceId: string, conversationId: string, participantId: string): Promise<void> {
  await redis.del(typingKey(workspaceId, conversationId, participantId));
}
