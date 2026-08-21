# Security

## Authentication

Passwords: Argon2id (OWASP baseline params in `lib/password.ts`). Login for an unknown email still runs a dummy verify so timing does not leak accounts. Signup **does** say the email is taken (accepted trade-off vs a silent form).

Sessions: opaque token in `gc_session`, `HttpOnly`, `SameSite=Lax`, `Secure` in production. Optional `COOKIE_DOMAIN=.apex` so `app.` and `api.` are same-site. A `*.pages.dev` dashboard origin makes the cookie third-party; attach a real subdomain of the API apex.

CSRF: Origin must match `DASHBOARD_ORIGIN` on POST/PATCH/PUT/DELETE, plus double-submit `gc_csrf` / `x-csrf-token`. Login, signup, and invitation accept skip the token (they mint it) but still check Origin when present. Widget and webhooks are exempt; they do not use the session cookie.

## Isolation

- Prisma tenant guard on models that have `workspace_id` (including `EmbedToken`).
- Composite FKs.
- Socket rooms include `workspaceId`.
- Widget queries also filter `contactId`.
- Foreign resources: 404.

## XSS

Sanitize on write. Chat allowlist is narrow; articles allow headings/tables/images (https only). Public KB escapes non-HTML fields. Widget iframe contains any residual HTML bug.

## Widget loader ↔ panel

The panel's `apiUrl`/`wsUrl` are baked in at build time (`WIDGET_API_URL`/`WIDGET_WS_URL`, esbuild `define`), never taken from the loader's `init` `postMessage`. That channel crosses the host page's real origin, which varies per install, so it cannot be authenticated with an `event.origin` check the way the reverse direction (panel → loader, in `loader.ts`) can — see `documentation/07-widget.md`. Trusting `apiUrl`/`wsUrl` from it would let any script on the host page (a compromised page, or an XSS on it) redirect the panel's REST calls and socket connection, carrying the real widget token, to an attacker-controlled endpoint.

## Other

- Structured logs redact secrets, tokens, and message bodies by key name at any depth.
- Rate limits: Redis sliding window, fail **open** if Redis is down (availability over a lockout). Login is limited per IP and per email **before** Argon2.
- `trust proxy` is 1 hop (Caddy).
- Webhooks fail closed when email is configured and the signing secret is missing.
- Widget socket Origin is client-reported; the token is the control.
