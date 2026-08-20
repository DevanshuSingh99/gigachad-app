# Gigachad

A multi-tenant customer communication platform: embeddable live chat, an email channel that threads correctly, a unified inbox, a knowledge base with public search, AI issue summarization, and customer-owned custom domains with real HTTPS.

Built for the SuperProfile "Build Intercom. From Scratch." assignment.

> Placeholders below marked `TODO` are filled in during the submission step.

## Live links

| What | URL |
|---|---|
| Dashboard | `TODO` |
| Widget demo page | `TODO` |
| Public knowledge base | `TODO` |
| API | `TODO — api.<domain>` |
| Support email (routes into the unified inbox) | `TODO — <workspace-slug>@inbound.TODO` |

Evaluators can sign up directly on the dashboard; no invitation or seed data is required. A fresh workspace starts empty.

## What's built

| Requirement | Status | Notes |
|---|---|---|
| M1 Auth and team management | `TODO` | Email/password, sessions, workspace creation, invitations, Admin/Agent roles, conversation assignment |
| M2 Live chat widget | `TODO` | One script tag, iframe-isolated panel, realtime messaging, typing, presence, read receipts, persisted history |
| M3 Email channel | `TODO` | Brevo inbound parsing, `Message-ID`/`In-Reply-To`/`References` threading, dashboard replies |
| M4 Unified inbox | `TODO` | Chat and email in one list; channel/assignee/status filters; assign, snooze, resolve |
| M5 Knowledge base | `TODO` | Rich text with a sanitizing allowlist, categories, publish lifecycle, public search, widget suggestions |
| M6 AI summarization | `TODO` | Agent-triggered summaries on conversations of 6+ messages; goal, tried, status; queued/ready/stale/error states |
| M7 Custom domains | `TODO` | DNS verification plus Caddy on-demand TLS with Let's Encrypt |

## What's skipped

Deliberate omissions, with reasoning in [docs/11-tradeoffs.md](docs/11-tradeoffs.md):

- **All stretch features** — AI auto-reply drafts, canned responses, contact timeline, SLA tracking, webhooks/public API, analytics dashboard.
- **Attachments** on both channels. Canonical plain text and sanitized HTML only.
- **Automated database backups.** Intentionally absent on this single-VM deployment. Unacceptable for real production and called out as such.
- **Broad automated test coverage.** Roughly 15 targeted tests cover tenant isolation, socket isolation, widget token scope, webhook replay, sanitization, and deduplication. Everything else is verified manually.
- **Per-agent read state.** Read position is per conversation, per side.
- **Hard delete for KB articles.** Unpublish is the removal path.
- **Cross-device chat history recovery.** Anonymous visitor identity is scoped to browser storage.

## Architecture

A modular monolith backend with a statically hosted frontend.

Everything that touches the database is one Node process on an Oracle VM: REST API, Socket.IO, and the server-rendered public knowledge base, with a BullMQ worker alongside it from the same image. PostgreSQL is authoritative; Redis backs queues, rate limits, and ephemeral presence. All of it runs in Docker Compose behind Caddy and comes up with one command.

The dashboard, demo page, and widget assets are a static build on Cloudflare Pages. They hold no secrets and reach the backend only through the public API.

```
        ┌──────────── Cloudflare Pages ─────────┐
Agent ─▶│ app.<domain>   dashboard + /widget    │
Site  ─▶│ demo.<domain>  demo page (own origin) │
        └──────────────┬────────────────────────┘
                       │ HTTPS + WSS, credentialed CORS
        ┌──────────────▼───── Oracle VM / Docker ┐
Visitor▶│ Caddy ─┬─ api.<domain>   API + Socket.IO│
custom ▶│        ├─ kb.<domain>    public KB (SSR)│
domain  │        └─ on-demand TLS (Let's Encrypt) │
        │  worker · postgres · redis              │
        └─────────────────────────────────────────┘
```

The split is drawn where it costs nothing. The dashboard is an authenticated, per-tenant SPA that gains nothing from server rendering, so shipping it as static files to a CDN removes a Next.js process from a 1 vCPU box. The backend keeps its module boundaries and transactional consistency, which is where the requirements are actually hard — no service-to-service calls, no distributed transactions, no duplicated auth logic.

The public KB deliberately did **not** move to Pages: M7 requires resolving an arbitrary customer hostname from the `Host` header and issuing a certificate for it on demand, which is Caddy's job, and server rendering gives crawlers real HTML for articles created at runtime.

Decisions worth reading about:

- **Modular monolith backend, split static frontend** — one process for everything transactional, a CDN for everything that is just a client. [docs/11-tradeoffs.md](docs/11-tradeoffs.md)
- **Dashboard on a subdomain of the API's apex domain** — makes dashboard-to-API requests same-site, so the session stays an `HttpOnly` cookie rather than a bearer token any XSS could read. On a `*.pages.dev` URL the cookie would be third-party and Safari would drop it. [docs/10-deployment.md](docs/10-deployment.md)
- **One command to deploy the backend** — `docker compose up -d --build`, with a one-shot migration service ordered by Compose so migrations never need a second step. [docs/10-deployment.md](docs/10-deployment.md)
- **PostgreSQL for search too** — full-text for the public KB, `pg_trgm` for the widget's partial-word suggestions. No Elasticsearch. [docs/04-database.md](docs/04-database.md)
- **Message ordering by allocated sequence** — the send transaction bumps a counter on the conversation row and uses the returned value, giving gapless per-conversation ordering and a natural reconnect cursor. [docs/04-database.md](docs/04-database.md)
- **Three separate auth namespaces** — dashboard sessions, scoped widget tokens, provider signatures. No route accepts more than one. [docs/05-api.md](docs/05-api.md)
- **Widget in an iframe** — CSS and script isolation in both directions, and any sanitizer gap executes in our frame rather than the customer's site. [docs/15-frontend-and-widget.md](docs/15-frontend-and-widget.md)
- **Caddy on-demand TLS for custom domains** — real Let's Encrypt certificates for customer hostnames without a paid SaaS-TLS product, gated by an `ask` endpoint that only approves verified domains. [docs/11-tradeoffs.md](docs/11-tradeoffs.md)
- **Agent-triggered AI summaries** — a deliberate deviation from generating on open, so cost tracks support load rather than inbox browsing; staleness is tracked durably so a summary is never shown as fresher than it is. [docs/11-tradeoffs.md](docs/11-tradeoffs.md)

Build order, per-phase tasks, and acceptance gates: [docs/18-execution.md](docs/18-execution.md).

Full documentation index: [docs/00-index.md](docs/00-index.md).

## Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript |
| Repo | npm workspaces monorepo (`apps/*`, `packages/shared`) |
| Dashboard | Next.js static export, React, HeroUI (formerly NextUI) + Tailwind CSS |
| Public KB | Eta templates rendered by the API, plain Tailwind |
| API | Express + TypeScript, domain services, Zod validation |
| Database | PostgreSQL with Prisma, `pg_trgm` |
| Client state | TanStack Query, invalidated by Socket.IO events |
| Realtime | Socket.IO |
| Queue | BullMQ on Redis |
| Email | Brevo (inbound parsing + transactional send) |
| AI | OpenAI-compatible adapter |
| Proxy / TLS | Caddy with on-demand TLS |
| Backend deploy | Docker Compose on an Oracle VM, built on the VM, one command |
| Frontend deploy | Cloudflare Pages, git push |

## Local setup

Requires Docker and Docker Compose. Node 20+ only if you want to run the dashboard outside Docker.

```bash
git clone <repo-url> && cd gigachad-app
cp .env.example .env     # fill in the values below
docker compose up -d --build
```

That is the whole backend: PostgreSQL, Redis, migrations, API, and worker. API on `http://localhost:3000`, public KB on `http://localhost:3000/kb/<workspace-slug>`.

The dashboard runs separately during development:

```bash
npm install
npm run dev --workspace apps/dashboard
```

Visit `http://localhost:3001/signup` to create the first workspace, and `http://localhost:3001/demo` for the widget.

### Deploying

Backend, on the VM:

```bash
git pull && docker compose up -d --build
```

The same command as local development — `COMPOSE_FILE` in the VM's `.env` selects the production overlay that adds Caddy, restart policies, and resource limits, so nothing is typed differently in production.

Frontend deploys itself: Cloudflare Pages builds on push. Full setup, including the DNS records and the custom domain the cookie auth depends on, is in [docs/10-deployment.md](docs/10-deployment.md).

### Environment variables

**VM** (`.env`, read by Compose):

| Variable | Purpose |
|---|---|
| `COMPOSE_FILE` | Set to `compose.yaml:compose.prod.yaml` on the VM; omit locally |
| `POSTGRES_PASSWORD` | Database password |
| `DATABASE_URL` | Connection string. Append `?connection_limit=8` for the API, `4` for the worker |
| `REDIS_URL` | Redis connection string |
| `SESSION_SECRET` | Random 32+ byte secret for session token hashing |
| `COOKIE_DOMAIN` | `.example.com` — must be the apex shared with the dashboard |
| `API_URL` | Public API base URL |
| `DASHBOARD_ORIGIN` | Exact dashboard origin, for CORS and CSRF origin checks |
| `KB_HOST` | Default public KB hostname |
| `KB_CNAME_TARGET` | Hostname customers point their `CNAME` at |
| `INBOUND_EMAIL_DOMAIN` | Inbound subdomain, e.g. `inbound.example.com` |
| `BREVO_API_KEY` | Transactional send |
| `BREVO_WEBHOOK_SIGNING_SECRET` | Inbound webhook verification |
| `MAIL_FROM` | Sender address on the verified sending domain |
| `OPENAI_API_KEY` | Omit to run with AI disabled; the rest of the product works |
| `OPENAI_MODEL` | Model id for summaries |
| `AI_SUMMARY_MIN_MESSAGES` | Summary threshold, default `6` |

**Cloudflare Pages** (build-time):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | API base URL |
| `NEXT_PUBLIC_WS_URL` | Socket.IO URL |
| `NEXT_PUBLIC_WIDGET_ASSET_URL` | Widget asset base URL |

All are validated at startup or build; the process refuses to boot on a missing required value rather than failing later.

### Provider configuration

Email requires DNS work that cannot be done from code — see the hour-zero checklist in [docs/07-email.md](docs/07-email.md):

1. Brevo domain authentication (DKIM + SPF records).
2. `MX` records for `inbound.<domain>` pointing at Brevo's inbound hosts.
3. Inbound webhook set to `https://<app-host>/api/v1/webhooks/email/inbound`.
4. Delivery events webhook set to `https://<app-host>/api/v1/webhooks/email/events`.

Each workspace's support address is `<workspace-slug>@inbound.<domain>`, shown in workspace settings.

Custom domains need no provider account: the customer adds a `CNAME` to `KB_CNAME_TARGET` plus a `TXT` ownership token, clicks Verify, and Caddy issues a certificate on the first HTTPS request. If their domain sits behind a proxying CDN, the `CNAME` must be DNS-only or the HTTP-01 challenge is intercepted.

## Testing

```bash
npm test
```

Covers cross-workspace access across every resource, Socket.IO room isolation, widget token scope, webhook signature and replay handling, HTML sanitization on articles and inbound email, message deduplication, and conversation status transitions. Scope and reasoning: [docs/13-testing-strategy.md](docs/13-testing-strategy.md).

## Known limitations

- No automated database backups. The single VM holds the only copy of the data.
- Automated coverage is narrow by design; most verification is manual.
- Presence is best-effort with a 30s heartbeat timeout — no historical presence or explicit availability status.
- AI summaries are generated on request rather than automatically when an agent opens a conversation. This is a knowing deviation from the requirement's wording; reasoning in [docs/11-tradeoffs.md](docs/11-tradeoffs.md).
- One support mailbox per workspace.
- Anonymous chat history is scoped to browser storage; clearing it creates a new contact.
- Workspace deletion is not implemented.
- Attachments are not supported on either channel.
- Custom domain certificates are issued per hostname on the origin, which is exposed to Let's Encrypt rate limits at volume. Cloudflare Custom Hostnames is the documented migration path.
- Single app instance: the Socket.IO Redis adapter is wired but untested under horizontal scale.
- The dashboard must be served from a subdomain of the API's apex domain. A `*.pages.dev` URL will not authenticate, because the session cookie becomes third-party.
- The backend image builds on the VM, so a deploy briefly competes with PostgreSQL for memory. Swap covers it; a busier box would want the build moved off-host.
