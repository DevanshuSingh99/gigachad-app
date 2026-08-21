# Repo and stack

npm workspaces. Node 20+.

```
gigachad-app/
  apps/api          Express API, Socket.IO, Prisma, public KB templates, BullMQ worker
  apps/dashboard    Next.js static export (agent UI)
  apps/widget       Loader script + iframe panel
  apps/demo         Host page that embeds the widget
  packages/shared   Zod contracts, error codes, rate-limit numbers, socket events
  documentation/    This folder
```

## Runtime split

| Process | Role |
|---|---|
| `apps/api` (`server.ts`) | REST, Socket.IO, Eta-rendered public KB |
| `apps/api` (`worker.ts`) | BullMQ: outbound email, AI summaries |
| PostgreSQL 16 | Source of truth |
| Redis 7 | Queues, rate limits, presence, Socket.IO adapter |
| Caddy (production overlay) | TLS, reverse proxy, on-demand certs for custom KB hosts |
| Cloudflare Pages | Dashboard, demo, widget static assets |

The API and worker are the same Docker image, different commands. They share the schema; they do not share in-process memory. Realtime events from jobs go through the Socket.IO Redis adapter.

## Why a modular monolith

Inbox, email ingest, and widget send all need one transaction and one `workspace_id` predicate. Splitting those into services would add network boundaries without removing the hard parts (tenancy, ordering, idempotency). The dashboard is static because it is an authenticated SPA; the public KB stays on the API because custom hostnames and crawler HTML are origin problems, not CDN problems.
