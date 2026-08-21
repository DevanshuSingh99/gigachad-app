# Product

Gigachad is a workspace-scoped helpdesk. An **Admin** creates a workspace, invites **Agents**, and embeds a chat widget on a customer site. Chat and email land in one inbox. Published articles power a public knowledge base and in-widget suggestions. Agents can request an AI summary of a long thread.

## Users

| Actor | How they authenticate | What they can do |
|---|---|---|
| Admin / Agent | Email + password, `HttpOnly` session cookie | Inbox, members (Admin), KB, domains, embed tokens, AI summary |
| Website visitor | Short-lived widget token scoped to one contact | Chat, read receipts, typing, KB suggestions |
| Mail provider | HMAC / bearer webhook signature | Inbound mail, delivery events |
| Caddy | Internal TLS-ask route | Confirm a hostname is a verified custom domain |

Signup creates a user, a workspace, an Admin membership, and a session in one transaction. Evaluators do not need seed data.

## Channels

- **Chat** — widget iframe talks to `/api/v1/widget` and Socket.IO. First send creates the conversation.
- **Email** — address is `<workspace-slug>@<INBOUND_EMAIL_DOMAIN>` (production: `{slug}@inbound.devjs.in`). Dashboard replies go out over SMTP with RFC threading headers.

Both channels write the same `conversations` / `messages` tables. The inbox filters by channel, status (`OPEN` / `SNOOZED` / `RESOLVED`), and assignee.

## Explicitly not built

These are skipped on purpose, not unfinished tickets:

- Attachments
- AI auto-replies, macros, SLA, public REST API, analytics
- Workspace deletion and hard-delete of KB articles (unpublish instead)
- Database backups on the single-VM deploy
- Recovering anonymous chat history after the visitor clears browser storage
- Per-agent read cursors (read state is per conversation, customer vs agent)

AI summaries are **agent-triggered**, not generated every time someone opens a thread. That keeps spend tied to actual work, not inbox browsing.
