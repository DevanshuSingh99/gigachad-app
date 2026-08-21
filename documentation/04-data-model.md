# Data model

Prisma schema: `apps/api/prisma/schema.prisma`. Extra SQL in migrations: `pg_trgm`, partial unique indexes on contacts, `NULLS NOT DISTINCT` uniqueness for idempotency keys, generated `search_vector` on articles.

## Conventions

- UUID primary keys, UTC timestamps, snake_case columns.
- Every tenant-owned row has `workspace_id`. Repositories put that in `WHERE`. A Prisma extension **throws** if a listed tenant model is queried without it (`apps/api/src/db.ts`). Escape hatch is `unscoped('reason', fn)` and is greppable.
- Child rows use composite foreign keys `(workspace_id, parent_id)` so attaching a row to another workspace’s parent is a database error.
- A missing row and a row in another workspace are the same HTTP outcome: **404**, never 403.

## Important tables

| Table | Role |
|---|---|
| `users` / `sessions` | Platform identity. Session cookie stores an opaque token; DB stores the hash. |
| `workspaces` | Tenant. Public `widget_key`, stored `support_address`. |
| `workspace_members` | `ADMIN` or `AGENT`, `ACTIVE` or `REMOVED`. |
| `contacts` | Customer inside one workspace. Email / `external_key` uniqueness is partial so many anonymous contacts can coexist. |
| `conversations` | Unified thread. `message_count` is the sequence allocator. Agent/customer last-read sequences live here. |
| `messages` | Durable body. Unique `(conversation_id, sequence)` and `(conversation_id, client_message_id)`. |
| `email_threads` / `email_messages` | RFC ids, References chain, delivery status. Thread matching is scoped to the workspace. |
| `ai_summaries` | One row per conversation. Staleness = conversation has a newer last message than `source_last_message_id`. |
| `widget_sessions` | Hashed public token, contact + workspace, expiry. |
| `embed_tokens` | Per-origin `wk_embed_…` keys. |
| `knowledge_articles` | Draft/published, sanitized HTML, plain `body_text` for search. |
| `custom_domains` | Hostname + verification token. Certificate state is Caddy’s, not a column. |
| `idempotency_keys` | Webhook / write dedup. `workspace_id` may be null for events that arrive before routing. |

## Message ordering

Sends lock the conversation row, increment `message_count`, and store that integer as `messages.sequence`. Clients sort by `sequence`, not `created_at`. Reconnect sends `lastSequence` and receives `conversation:sync` for everything after it.
