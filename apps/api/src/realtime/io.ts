import { createServer, type Server as HttpServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

import { createAdapterConnections } from '../lib/redis';
import { logger } from '../lib/logger';
import { socketAuthMiddleware } from './auth';
import { setIoServer } from './emit';
import { registerConnectionHandlers } from './handlers/connection';
import type { IoServer } from './types';

/**
 * Attaches Socket.IO to the API's own HTTP server — one process serves REST and
 * WebSocket traffic, per docs/03-architecture.md.
 *
 * CORS here is deliberately permissive (`origin: true`, no credentials) for
 * every socket, dashboard and widget alike. That looks wrong next to the
 * dashboard's strict REST CORS, but it is not a lesser check — it is the SAME
 * check moved to where it can actually see what it needs to see. Socket.IO
 * delivers the auth payload (session cookie is automatic; the widget token is
 * explicit) only after the transport already connected, so at CORS-decision
 * time there is no way to know which workspace's allowlist would even apply.
 * `socketAuthMiddleware` (auth.ts) is the real gate: it runs after the payload
 * is visible and rejects the connection outright — Socket.IO turns that into a
 * `connect_error` and tears down the transport before any room is joined or any
 * handler runs. A rejected socket briefly completes a handshake and nothing
 * more; it never reaches application data.
 *
 * `credentials: true` here does not weaken the widget side: `origin: true`
 * makes the underlying `cors` package REFLECT the requesting Origin as the
 * literal Access-Control-Allow-Origin value, never the wildcard string `*` —
 * reflecting a specific origin is spec-legal to combine with credentials,
 * unlike an actual `*`. The dashboard socket needs this: without it the browser
 * refuses to attach the session cookie to the handshake at all, and every
 * connection fails closed before socketAuthMiddleware ever runs (confirmed live
 * — the first attempt at this shipped `credentials: false` and dashboard
 * sockets could not connect). The widget's security is unaffected either way,
 * since it authenticates with a bearer token, never a cookie.
 */
export function attachSocketServer(httpServer: HttpServer): IoServer {
  const io: IoServer = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    // Idle proxies (Caddy) otherwise look like a dead peer and flap presence.
    pingInterval: 20_000,
    pingTimeout: 60_000,
  });

  const { pubClient, subClient } = createAdapterConnections();
  io.adapter(createAdapter(pubClient, subClient));
  io.engine.on('close', () => {
    void pubClient.quit();
    void subClient.quit();
  });
  logger.info('socket.io redis adapter attached');

  io.use(socketAuthMiddleware);
  registerConnectionHandlers(io);

  // Lets modules/messages/service.ts (and anything else in the write path)
  // broadcast without importing the server instance directly — see emit.ts.
  setIoServer(io);

  return io;
}

/**
 * Socket.IO server used by the worker process to publish into the same Redis
 * adapter the API listens on. Bound to an HTTP server that never `.listen()`s
 * — `new Server()` with no argument leaves `io.engine` undefined, which
 * crashed the worker on the adapter-close hook. `ioRef` in this process is
 * otherwise null, so `emitSummaryUpdated` / `emitMessageUpdated` from a job
 * would no-op and the dashboard would sit on "Generating…" forever.
 */
export function attachRealtimeEmitter(): IoServer {
  const io: IoServer = new Server(createServer());
  const { pubClient, subClient } = createAdapterConnections();
  io.adapter(createAdapter(pubClient, subClient));
  io.engine.on('close', () => {
    void pubClient.quit();
    void subClient.quit();
  });
  setIoServer(io);
  logger.info('socket.io worker emitter attached');
  return io;
}
