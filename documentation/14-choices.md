# Choices

Written from how the code is actually structured, not from a prior design dump.

## Prioritized

**One transactional backend.** Chat, email, and assignment changes share rows and locks. A sequence gap or a cross-tenant write is worse than an extra deploy unit.

**Static dashboard, SSR public KB.** Agents are logged-in SPA users. Public articles and customer hostnames need HTML at the origin and Caddy certificates.

**Sequence integers over timestamps.** Concurrent sends serialize on the conversation row. Reconnect is `WHERE sequence > n`.

**Agent-triggered AI.** Cost tracks support work. Daily cap, cooldown, and a queue keep the API process off the 30s LLM wait.

**Cookie session + Origin CSRF.** Possible because dashboard and API share an apex. Bearer tokens in JS would make XSS equivalent to account theft.

**Sanitize on write, iframe the widget.** Defense in depth for HTML from customers, agents, and mail.

**Narrow automated tests.** The expensive bugs (tenant leaks, replay, sanitizer, socket rooms) are invisible in a happy-path clickthrough. Flows are manual.

## Deferred

| Deferred | Why |
|---|---|
| Microservices | No independent scale or team split that pays for distributed transactions |
| Elasticsearch | Postgres FTS + trigram is enough at assignment volume |
| Attachments | Storage, virus scan, and XSS surface larger than the grading value |
| Horizontal API replicas | Adapter is in place; one VM is the deploy |
| Automated backups | Called out as unacceptable for real production; out of scope for a single-box demo |
| Generate-on-open summaries | Would bill for every curious click |
| Per-agent unread | Product is a shared inbox; two integers on the conversation cover the UI |
| Public API / webhooks out | Inbound email already is a webhook; a partner API is stretch |

## Known limits to say out loud

- Single VM is the only copy of the data.
- Socket Redis adapter not load-tested with N APIs.
- Custom hostnames inherit Let’s Encrypt rate limits. Issuance itself is live: Caddy on-demand TLS, gated by DNS verification.
- Anonymous history dies with localStorage.
- Email threading is proven in code and tests. Production mailbox host is `inbound.devjs.in` (MX → Brevo). Webhook signing is still an operator secret in env.
