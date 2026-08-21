# Realtime

Socket.IO shares the API HTTP server. The worker process attaches an emitter-only server on the same Redis adapter so jobs can publish `summary:updated` and `message:updated`.

## Handshake

CORS on the socket server reflects the request Origin and allows credentials. That is **not** the security boundary. `socketAuthMiddleware` runs after the payload is visible:

- **Agent:** `Origin` must equal `DASHBOARD_ORIGIN`. Cookie session + active membership for the claimed `workspaceId`. The client cannot pick a workspace the user is not in.
- **Widget:** `auth.widgetToken` plus a cooperative `auth.origin` (the panel iframe is same-origin to the app, so the browser Origin header is not the customer site). The bearer token is the real gate; origin allowlist is extra.

A failed handshake never joins a room.

## Rooms

- Agents join `workspace:{workspaceId}` on connect (inbox list updates).
- Anyone joins `conversation:{workspaceId}:{conversationId}` only after a scoped lookup (agent: any conversation in the workspace; widget: that contact’s conversation).

## Events (subset)

Client → server: `conversation:subscribe`, `message:send`, `message:read`, `typing:start` / `typing:stop`.

Server → client: `conversation:sync`, `message:new`, `message:updated`, `message:read`, `presence:update`, `summary:updated`, `conversation:updated`.

Payloads do **not** include `workspaceId`. The server already bound it on the socket.

## Ordering and reconnect

Subscribe with `{ conversationId, lastSequence }`. The server emits up to 200 missed messages (`REALTIME.syncMessageCap`). If more are missing, `truncated: true` and the client falls back to HTTP pagination.

The dashboard stores the highest sequence it already has and sends that on reconnect (not always `0`). The widget does the same and, if truncated, walks `/widget/.../messages` cursors.

Widget also keeps an outbox in `localStorage` keyed by widget key. Retries reuse `clientMessageId` so a dropped ack cannot double-insert.

## Presence and typing

Redis keys with TTLs (~30s presence, ~5s typing). Heartbeat from the socket. Best-effort; not an availability roster.

Both clients re-send `typing:start` every ~60% of the typing TTL for as long as the composer stays non-empty, not just once at the top of a burst — a single start would let the receiver's indicator expire mid-burst on a continuous typer, since the server only refreshes the Redis key's TTL when a `typing:start` actually arrives.

Presence/typing snapshot reads (`listOnline`/`listTyping`) use Redis `SCAN` in small cursor steps, not `KEYS` — `KEYS` is O(total keyspace size), not O(matches), and blocks the single-threaded Redis event loop for every other workspace's traffic regardless of how selective the pattern is.

Out-of-order delivery (possible once the Redis Socket.IO adapter fans events across multiple API instances) is handled by insertion-sorting incoming messages by `sequence` on both clients, rather than assuming arrival order — `markRead`/`subscribeToConversation` read the array's last element and would otherwise report a stale cursor.
