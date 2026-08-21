# Gigachad documentation

This folder is the project documentation for **Gigachad**, a multi-tenant support product: live chat widget, email inbox, knowledge base, AI summaries, and custom-domain public help sites.

**Evaluators:** start with the [root README](../README.md) — live dashboard, chat-bubble demo, inbound mailbox, and repo. This folder is the architecture and ops detail.

Start here if you are running or extending the repo.

| File | What it covers |
|---|---|
| [01-product.md](01-product.md) | What ships, who uses it, what was left out |
| [02-repo-and-stack.md](02-repo-and-stack.md) | Monorepo layout and technology choices |
| [03-running-locally.md](03-running-locally.md) | Environment, Compose, dashboard, tests |
| [04-data-model.md](04-data-model.md) | PostgreSQL schema and tenancy rules |
| [05-http-api.md](05-http-api.md) | REST surface, envelopes, auth namespaces |
| [06-realtime.md](06-realtime.md) | Socket.IO rooms, sequences, reconnect |
| [07-widget.md](07-widget.md) | Embed script, iframe panel, tokens |
| [08-email.md](08-email.md) | Inbound parse, SMTP send, threading |
| [09-ai.md](09-ai.md) | Summaries, queues, cost controls |
| [10-knowledge-base.md](10-knowledge-base.md) | Dashboard editor, public SSR, custom domains |
| [11-security.md](11-security.md) | Sessions, CSRF, sanitization, isolation |
| [12-deploy.md](12-deploy.md) | VM + Caddy + Cloudflare Pages |
| [13-testing.md](13-testing.md) | Automated suite and how to run it |
| [14-choices.md](14-choices.md) | What we optimized for and what we deferred |
| [15-analytics.md](15-analytics.md) | Admin-only metrics: response times, resolution, agent performance |

Source of truth for types and limits is `packages/shared`. Source of truth for tables is `apps/api/prisma/schema.prisma`.
