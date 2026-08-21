# Gigachad

A multi-tenant customer communication platform: embeddable live chat, an email channel that threads correctly, a unified inbox, a knowledge base with public search, AI issue summarization, and customer-owned custom domains.

Built for the SuperProfile “Build Intercom. From Scratch.” assignment.

## Submission

These are the four things to review. Sign up yourself — nothing is pre-seeded.

### 1. Live product (dashboard)

**https://gigachad-app.devjs.in**

Create an account at [/signup](https://gigachad-app.devjs.in/signup). You become Admin of a new workspace. From there: inbox, team invites, knowledge base, custom domains (CNAME + TXT, then Caddy serves the help site over HTTPS), embed tokens, and AI summaries (on conversations with 6+ messages, when the OpenAI key is configured).

API (health): [https://gigachad-api.devjs.in/health/ready](https://gigachad-api.devjs.in/health/ready)

Public knowledge base, after you publish an article: `https://gigachad-kb.devjs.in/api/v1/public/<your-workspace-slug>/kb`

### 2. Live chat bubble (separate origin)

**https://gigachad-demo.devjs.in**

This is a standalone page, not the dashboard. The widget is installed there on purpose so you can send a message from a real customer origin and watch it arrive in the inbox over Socket.IO.

To land those messages in **the workspace you just created**:

1. In the dashboard, open **Embed**.
2. Create a token whose allowed origin is exactly `https://gigachad-demo.devjs.in` (no trailing slash).
3. Open `https://gigachad-demo.devjs.in/?key=<the-wk_embed_token>`.
4. Send a message. It should appear in **Inbox** without a refresh.

Omitting `?key=` uses a default token for a pre-existing workspace, which will not show up in your new account.

### 3. Email inbox

Production inbound domain: **`inbound.devjs.in`** (MX → Brevo / Sendinblue).

Mailbox for a workspace:

```text
<workspace-slug>@inbound.devjs.in
```

The slug is the workspace name you typed at signup, lowercased and hyphenated. The exact address is shown in the dashboard sidebar and on **Team**.

What to try:

1. Mail that address from any mailbox.
2. Confirm a new **EMAIL** conversation in Inbox (HTML is sanitized; the canonical body is plain text).
3. Reply from the dashboard, then reply again from your mail client — the second inbound should thread into the same conversation (`In-Reply-To` / `References`, not subject matching).

### 4. GitHub repository

**https://github.com/DevanshuSingh99/gigachad-app**

Commit history is incremental (phases of the product, not a single dump). This README is the evaluator-facing overview; deeper notes live in [`documentation/`](documentation/README.md).

---

## Architecture

A modular monolith backend with a statically hosted frontend.

Everything that touches the database is one Node process: REST API, Socket.IO, and the server-rendered public knowledge base, plus a BullMQ worker from the same image. PostgreSQL is authoritative; Redis backs queues, rate limits, and ephemeral presence.

Caddy terminates TLS on the VM for `gigachad-api.devjs.in`, `gigachad-kb.devjs.in`, and **verified customer knowledge-base hostnames**. On-demand Let’s Encrypt certificates are issued only when Caddy’s `ask` call (`GET /internal/tls/ask`) finds a `custom_domains` row with status `VERIFIED`. The dashboard, demo page, and widget assets are a static Cloudflare Pages build. They hold no secrets and talk only to the public API.

```
        ┌──────────── Cloudflare Pages ─────────────┐
Agent ─▶│ gigachad-app.devjs.in   dashboard + widget│
Site  ─▶│ gigachad-demo.devjs.in  demo (own origin) │
        └──────────────────┬────────────────────────┘
                           │ HTTPS + WSS, credentialed CORS
        ┌──────────────────▼──── Oracle VM / Docker ─┐
Visitor▶│ Caddy ─┬─ gigachad-api.devjs.in  API + WS │
custom ▶│        ├─ gigachad-kb.devjs.in   public KB│
domain  │        └─ on-demand TLS (Let’s Encrypt)   │
        │  worker · postgres · redis                │
        └───────────────────────────────────────────┘
```

The split is drawn where it costs nothing. The dashboard is an authenticated SPA that gains nothing from server rendering, so shipping it to a CDN removes a Next.js process from a 1 vCPU box. The backend keeps module boundaries and transactional consistency — no service-to-service calls, no distributed transactions, no duplicated auth.

The public KB stays on the API: custom-domain help sites need the `Host` header and a certificate at the origin, and crawlers need HTML for articles created at runtime. An admin adds a hostname, proves DNS (CNAME + TXT), clicks Verify, then Caddy serves that host over HTTPS. Unverified names never get a certificate. [documentation/10-knowledge-base.md](documentation/10-knowledge-base.md), [documentation/12-deploy.md](documentation/12-deploy.md).

Trade-offs (what we spent the week on, what we refused, and where that is written down): [Trade-off decisions](#trade-off-decisions). Detail: [documentation/14-choices.md](documentation/14-choices.md). Full index: [documentation/README.md](documentation/README.md).

## Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript |
| Repo | npm workspaces (`apps/*`, `packages/shared`) |
| Dashboard | Next.js static export, React, HeroUI + Tailwind CSS |
| Public KB | Eta templates rendered by the API |
| API | Express, domain services, Zod |
| Database | PostgreSQL with Prisma, `pg_trgm` |
| Client state | TanStack Query, invalidated by Socket.IO |
| Realtime | Socket.IO (Redis adapter wired, single instance live) |
| Queue | BullMQ on Redis |
| Email | Brevo inbound parse + SMTP relay |
| AI | OpenAI-compatible adapter |
| Proxy / TLS | Caddy (on-demand Let’s Encrypt for verified KB hosts) |
| Backend deploy | Docker Compose on an Oracle VM, Caddy at the edge |
| Frontend deploy | Cloudflare Pages on git push |

## What's built vs skipped

| Requirement | Status | Notes |
|---|---|---|
| M1 Auth and team | done | Email/password, sessions, workspace create, invites, Admin/Agent, assignment |
| M2 Live chat widget | done | One script tag, iframe panel, realtime, typing, presence, receipts, history |
| M3 Email channel | done | Inbound parse, RFC threading, dashboard replies |
| M4 Unified inbox | done | Chat + email; filters; assign / snooze / resolve |
| M5 Knowledge base | done | Sanitized rich text, categories, publish, public search, widget suggestions |
| M6 AI summarization | done | Agent-triggered on 6+ messages; queued / ready / stale / error |
| M7 Custom domains | done | DNS verification in the dashboard; Caddy issues HTTPS only for `VERIFIED` hosts |

**Skipped on purpose** — stretch product (auto-replies, macros, SLA, analytics, partner API), attachments, backups, per-agent unread, hard-delete of articles, workspace deletion, recovering anonymous chat after storage is cleared. Why each is out: next section and [documentation/14-choices.md](documentation/14-choices.md).

## Trade-off decisions

The grading risk on this assignment is a silent tenant leak, a garbled thread, or a widget that only works in a screenshot. We spent the budget there and wrote the “no”s down so they read as choices, not unfinished tickets.

### What we prioritized

| Choice | Instead of | Why |
|---|---|---|
| One modular monolith (API + Socket.IO + public KB in one process, worker beside it) | Microservices per channel | Chat, email, and assignment share rows and locks. A sequence gap or a cross-tenant write is worse than an extra deploy unit. |
| Static dashboard on Pages, SSR knowledge base on the API | Next.js for everything, or KB on the CDN | Agents are a logged-in SPA. Customer hostnames and crawler HTML need the `Host` header and a certificate at the origin — Caddy’s job. |
| Allocated `sequence` on send | Order by `created_at` | Concurrent sends serialize on the conversation row. Reconnect is `WHERE sequence > n`, gapless. |
| `HttpOnly` session cookie + Origin CSRF, dashboard on the API apex | Bearer token in JS | XSS must not equal account theft. `*.pages.dev` would make the cookie third-party; that URL is refused on purpose. |
| Three auth namespaces (session, widget token, webhook signature) | One “auth header” | A widget token must never open the dashboard; a session must never call `/widget`. |
| Widget in an iframe; sanitize HTML on write | Trust the host page / sanitize on read | Customer CSS cannot break the panel; a sanitizer miss executes in our frame. |
| Agent-triggered AI summaries, queued on BullMQ | Generate every time an agent opens a thread | Cost tracks support work, not inbox browsing. The API process never waits 30s on the model. Daily cap, cooldown, JSON schema, staleness watermark. |
| Caddy on-demand TLS, gated by `/internal/tls/ask` | Paid custom-hostname SaaS from day one | Real HTTPS for verified KB domains without a per-hostname vendor. Unverified names never get a certificate. Let’s Encrypt rate limits are the known ceiling. |
| Postgres FTS + `pg_trgm` | Elasticsearch | Assignment volume does not pay for another cluster. Widget mid-word suggestions still work. |
| Inbound email as a signed webhook (Brevo), not IMAP | Poll a mailbox | Idempotency, signature verify-before-persist, and threading live in the same transaction as the inbox row. |
| Narrow automated tests (isolation, sockets, tokens, replay, sanitizer, dedup) | Broad UI coverage | The bugs that fail the rubric are invisible in a happy-path clickthrough. Flows are manual; the suite is for the expensive invariants. |

### What we deferred

| Deferred | Why now | When it would change |
|---|---|---|
| Attachments | Object storage, virus scan, and a much larger XSS surface than the grading value | When file upload is a scored requirement |
| Horizontal API replicas | Redis adapter is wired; one VM is the live deploy and untested at N | Real load, more than one `api` container |
| Automated DB backups | Out of scope for a single-box demo — **unacceptable** as real production | A second disk / managed Postgres before any real customers |
| Generate-on-open summaries | Would bill for every curious click | If the product brief forbids agent-triggered generation |
| Per-agent read cursors | Shared inbox; two integers on the conversation cover the UI | Personal inboxes |
| Public REST API / outbound webhooks | Inbound email already is a webhook; a partner API is stretch | Integrations |
| Stretch: auto-reply drafts, canned responses, contact timeline, SLA, analytics | Same week as a working unified inbox and widget | After M1–M7 are boring |
| Recovering anonymous chat after `localStorage` clear | Identity is the browser; pretending otherwise lies to the agent | Optional “email yourself a continuation link” |
| Workspace deletion / hard-delete of KB articles | Unpublish and leave history; delete is a recovery problem | Compliance export + tombstones |

### How those decisions are recorded

- **This section** is the evaluator-facing summary: prioritized vs deferred in one place.
- **[documentation/14-choices.md](documentation/14-choices.md)** is the living list; other files in `documentation/` explain the mechanism (sequences, cookies, Caddy ask, AI queue), not a second set of opinions.
- **Known limitations** below are the bill for the table above — same facts, phrased as constraints, not as TODOs.
- **Code comments** point at `documentation/` when a non-obvious constraint (tenant Prisma guard, cookie apex, tls/ask) would otherwise look like a quirk.

A skipped stretch feature is not listed under “coming soon.” If it is not in the prioritized table, it is out of scope for this repo.

## Local setup

Requires Docker Compose. Node 20+ only if you run the dashboard outside Docker.

```bash
git clone https://github.com/DevanshuSingh99/gigachad-app.git
cd gigachad-app
cp .env.example .env     # fill in the table below
docker compose up -d --build
```

Backend: Postgres, Redis, migrations, API, worker. API at `http://localhost:3000`. Public KB at `/api/v1/public/<workspace-slug>/kb`.

Dashboard:

```bash
npm install
npm run dev --workspace @gigachad/dashboard
```

Signup: `http://localhost:3001/signup`. Local widget demo: `npm run dev --workspace @gigachad/demo` (port 5500).

### Environment (VM / Compose)

| Variable | Purpose |
|---|---|
| `COMPOSE_FILE` | `compose.yaml:compose.prod.yaml:compose.caddy.yaml` on the VM; omit locally |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | Postgres. Append `?connection_limit=8` (API) / `4` (worker) |
| `REDIS_URL` | Redis |
| `SESSION_SECRET` | 32+ random bytes |
| `COOKIE_DOMAIN` | `.apex` shared with the dashboard; empty locally |
| `API_URL` / `DASHBOARD_ORIGIN` | Public API URL; exact dashboard origin (CORS + CSRF) |
| `KB_HOST` / `KB_CNAME_TARGET` | Default public KB host; CNAME target for customers |
| `INBOUND_EMAIL_DOMAIN` | Host part of the mailbox, e.g. `inbound.example.com` → `slug@inbound.example.com` |
| `BREVO_API_KEY` / `BREVO_WEBHOOK_SIGNING_SECRET` | Send + inbound verify |
| `MAIL_FROM` | Authenticated sending domain (not the inbound host) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Omit to run with AI disabled |
| `AI_SUMMARY_MIN_MESSAGES` | Default `6` |

Pages build-time: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_WIDGET_ASSET_URL`.

Missing required values refuse to boot (`apps/api/src/env.ts`).

Email DNS (not in this repo): SPF/DKIM on the sending domain; MX on `INBOUND_EMAIL_DOMAIN` to Brevo; webhooks to `/api/v1/webhooks/email/inbound` and `/events`. Details: [documentation/08-email.md](documentation/08-email.md).

### Tests

```bash
npm test
```

Needs Postgres and Redis on localhost for the HTTP/socket suite (`docker compose up -d postgres redis`). Without them those cases skip; unit tests still run. Scope: [documentation/13-testing.md](documentation/13-testing.md).

## Known limitations

These are the cost of the [trade-offs](#trade-off-decisions), not a backlog.

- No automated database backups. The VM holds the only copy of the data.
- Automated coverage is narrow; most flows are verified by hand.
- Presence is best-effort (30s heartbeat). No historical presence.
- AI summaries are on request, not on every inbox open. Reasoning: [documentation/09-ai.md](documentation/09-ai.md).
- One support mailbox per workspace.
- Anonymous chat identity is browser storage.
- Workspace deletion is not implemented.
- No attachments.
- Custom-domain certificates are issued per hostname by Caddy / Let’s Encrypt, so high volume can hit CA rate limits. Cloudflare Custom Hostnames is the documented scale-up path.
- Single app instance. Socket.IO Redis adapter is untested under horizontal scale.
- Dashboard must share an apex with the API. A `*.pages.dev` URL will not send the session cookie.
