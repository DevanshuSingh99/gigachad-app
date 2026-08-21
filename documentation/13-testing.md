# Testing

Command: `npm test` (Vitest in `@gigachad/api`).

Setup loads `.env`, rewrites Docker hostnames `postgres` / `redis` to `127.0.0.1` so the suite can run on the host, and forces `NODE_ENV=test` plus a known webhook secret.

## Always on (no Docker)

`apps/api/tests/unit.test.ts` — sanitizer, log redaction, slugs, hostname policy, References bounding, AI context trim, tenant-predicate helper, Argon2 round-trip.

## Needs Postgres + Redis

`apps/api/tests/isolation.test.ts` — the assignment-critical cases:

1–6 Tenant isolation (conversation, message post, contact, KB patch, list leak, domains)
7 Socket isolation (subscribe + message must not cross workspaces)
8–9 Widget token cannot call `/workspaces/*` or another contact’s thread
10–11 Webhook forgery / stale timestamp; duplicate provider event id
12–13 Script payloads stripped on article write/render and inbound HTML
14–15 `clientMessageId` idempotency; invalid snooze; customer message reopens `RESOLVED`

If port 5432 cannot answer, those tests **skip** so a laptop without Docker still gets a green unit run. Start `docker compose up -d postgres redis`, migrate, then re-run for the full suite.

**Gotcha when posting a signed raw `Buffer` with supertest:** always `.type('application/octet-stream')`, never `.set('Content-Type', 'application/json')`, on a request whose body is a `Buffer` you also HMAC-signed. superagent serializes any non-string `.send()` payload whose resolved content type is JSON, and `Buffer.prototype.toJSON()` turns the buffer into `{"type":"Buffer","data":[...]}` before it's written to the socket — so the bytes actually sent stop matching what was signed, and the request 401s regardless of whether the signature logic under test is correct. Tests 11 and 13 above were failing this way silently (the assertion checked `status >= 400`, so a wrong-reason 401 still passed) until the content type was corrected; the real route doesn't care (`express.raw({ type: '*/*' })` accepts any content type), so this is purely a test-harness detail.

There is no browser e2e pack. Manual checks: signup, widget round-trip, email thread (once MX exists), publish KB, custom domain verify, AI generate/stale/retry.
