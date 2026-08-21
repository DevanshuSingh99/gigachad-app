# Analytics

Admin-only dashboard: response times, resolution rate, busiest hours, volume trend, channel split, agent performance. `GET /api/v1/workspaces/:workspaceId/analytics/overview?range=7d|30d|90d`, guarded by `requireAdmin` — an Agent gets 403. The dashboard also hides the nav entry and redirects `/analytics` for Agents, but that is UX only; the route guard is the real enforcement.

Computed live on every request, no caching layer — deliberately, matching `documentation/14-choices.md`'s posture on caching (a missing `workspace_id` in a cache key is a tenant-leak bug waiting to happen). If this becomes a real cost at scale, the fix is a short Redis TTL keyed by `workspace_id` + `range`, not a rewrite.

## `firstResponseAt` / `resolvedAt`

Two nullable `Conversation` columns exist only for this feature — without them, response/resolution timing would have to be derived from message history on every page load. Two writers, both pre-existing choke points:

- **`conversations/repo.ts` `allocateSequenceAndMaybeReopen`** — every message send (dashboard, widget, inbound/outbound email) goes through this one atomic `UPDATE`. Sets `first_response_at` once, on the first-ever AGENT message; clears `resolved_at` on the same customer-reopen condition that already resets `status`/`snoozed_until`.
- **`conversations/service.ts` `patchConversation`** — an explicit agent PATCH to `RESOLVED` sets `resolved_at`; a PATCH to any other status clears it.

`firstResponseAt` is a lifetime value: set once, never moved by a later reply or reopen. `resolvedAt` tracks the *current* resolved episode: cleared on reopen, so a reopened conversation never reports a stale resolution time.

**Known limitation:** additive migration, no backfill. Conversations created before this feature shipped have `null` in both columns and are excluded from response-time/resolution-time averages (they still count toward volume/channel/busiest-hours, which don't depend on these columns).

## Query notes

First module to run real aggregates (`groupBy`, `$queryRaw` with `PERCENTILE_CONT`/`EXTRACT(HOUR ...)`/`date_trunc`). `groupBy`/`aggregate` are still checked by the tenant-scope Prisma extension in `db.ts`; raw SQL is not, so every query in `analytics/repo.ts` puts `workspace_id = $1` in the SQL by hand — this is the pattern to copy, not `unscoped()`, which is for genuinely cross-tenant reads.

Agent performance groups by the conversation's **current** `assignee_id`, not the full `conversation_assignments` history — a conversation reassigned mid-range counts entirely toward whoever holds it now. Busiest hours are UTC (no per-workspace timezone setting exists yet); the dashboard labels the chart accordingly rather than silently implying local time.
