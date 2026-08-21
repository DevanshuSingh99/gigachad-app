import { REALTIME, type ParticipantType } from '@gigachad/shared';

import { redis } from '../lib/redis';

/**
 * Presence and typing, entirely in Redis with short TTLs — never in process
 * memory, so this survives horizontal scale-out with zero code change (the same
 * reasoning as the Redis-backed Socket.IO adapter in lib/redis.ts). Docs/06-realtime.md:
 * "Presence is best-effort and expires; messages are durable." Losing Redis loses
 * presence, never a message.
 *
 * Presence is socket-refcount'd: two dashboard tabs of the same agent must not
 * flip the customer to "offline" when one tab closes. The TTL is a safety net
 * for an ungraceful disconnect (network drop with no close frame).
 */

function presenceKey(workspaceId: string, conversationId: string, participantId: string): string {
  return `presence:${workspaceId}:${conversationId}:${participantId}`;
}

function presenceSocketsKey(workspaceId: string, conversationId: string, participantId: string): string {
  return `presenceSockets:${workspaceId}:${conversationId}:${participantId}`;
}

function typingKey(workspaceId: string, conversationId: string, participantId: string): string {
  return `typing:${workspaceId}:${conversationId}:${participantId}`;
}

function asParticipantType(value: string | null): ParticipantType | null {
  return value === 'AGENT' || value === 'CUSTOMER' ? value : null;
}

/**
 * `KEYS` is O(total keys in the whole Redis instance), not O(matches) — it
 * blocks the single-threaded event loop for every other client, including
 * every other workspace's traffic, regardless of how selective the pattern
 * is. `SCAN` walks the same keyspace in small non-blocking cursor steps, so a
 * snapshot query for one busy conversation can't stall presence/typing for
 * everyone else.
 */
async function scanKeys(pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    found.push(...keys);
    cursor = next;
  } while (cursor !== '0');
  return found;
}

export async function addPresenceSocket(
  workspaceId: string,
  conversationId: string,
  participantId: string,
  participantType: ParticipantType,
  socketId: string,
): Promise<{ entered: boolean }> {
  const sockets = presenceSocketsKey(workspaceId, conversationId, participantId);
  const presence = presenceKey(workspaceId, conversationId, participantId);
  const results = await redis
    .multi()
    .sadd(sockets, socketId)
    .pexpire(sockets, REALTIME.presenceTtlMs)
    .set(presence, participantType, 'PX', REALTIME.presenceTtlMs)
    .scard(sockets)
    .exec();
  const card = Number(results?.[3]?.[1] ?? 0);
  return { entered: card === 1 };
}

export async function refreshPresenceSocket(
  workspaceId: string,
  conversationId: string,
  participantId: string,
  participantType: ParticipantType,
  socketId: string,
): Promise<void> {
  await addPresenceSocket(workspaceId, conversationId, participantId, participantType, socketId);
}

export async function removePresenceSocket(
  workspaceId: string,
  conversationId: string,
  participantId: string,
  socketId: string,
): Promise<{ left: boolean }> {
  const sockets = presenceSocketsKey(workspaceId, conversationId, participantId);
  const presence = presenceKey(workspaceId, conversationId, participantId);
  await redis.srem(sockets, socketId);
  const remaining = await redis.scard(sockets);
  if (remaining > 0) return { left: false };
  await redis.del(sockets, presence);
  return { left: true };
}

export async function listOnline(
  workspaceId: string,
  conversationId: string,
): Promise<Array<{ participantId: string; participantType: ParticipantType }>> {
  const keys = await scanKeys(presenceKey(workspaceId, conversationId, '*'));
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  const prefix = `presence:${workspaceId}:${conversationId}:`;
  const out: Array<{ participantId: string; participantType: ParticipantType }> = [];
  for (let i = 0; i < keys.length; i++) {
    const type = asParticipantType(values[i] ?? null);
    if (!type) continue;
    out.push({ participantId: keys[i]!.slice(prefix.length), participantType: type });
  }
  return out;
}

export async function markTyping(
  workspaceId: string,
  conversationId: string,
  participantId: string,
  participantType: ParticipantType,
): Promise<void> {
  await redis.set(typingKey(workspaceId, conversationId, participantId), participantType, 'PX', REALTIME.typingTtlMs);
}

export async function clearTyping(workspaceId: string, conversationId: string, participantId: string): Promise<void> {
  await redis.del(typingKey(workspaceId, conversationId, participantId));
}

export async function listTyping(
  workspaceId: string,
  conversationId: string,
): Promise<Array<{ participantId: string; participantType: ParticipantType }>> {
  const keys = await scanKeys(typingKey(workspaceId, conversationId, '*'));
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  const prefix = `typing:${workspaceId}:${conversationId}:`;
  const out: Array<{ participantId: string; participantType: ParticipantType }> = [];
  for (let i = 0; i < keys.length; i++) {
    const type = asParticipantType(values[i] ?? null);
    if (!type) continue;
    out.push({ participantId: keys[i]!.slice(prefix.length), participantType: type });
  }
  return out;
}
