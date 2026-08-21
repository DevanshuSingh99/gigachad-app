# HTTP API

Base path `/api/v1`. JSON envelope:

```json
{ "data": { } }
```

Errors:

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "requestId": "…" } }
```

Codes and HTTP statuses live in `packages/shared/src/errors.ts`. Field errors from Zod appear as `fieldErrors`. 429 responses include `Retry-After`.

Bodies are parsed with Zod at the handler (`parseBody` / `parseQuery` / `parseParams`). Do not cast `req.body`.

## Namespaces (do not mix credentials)

| Prefix | Credential |
|---|---|
| `/api/v1/auth`, `/api/v1/workspaces/…` | Session cookie `gc_session` + CSRF on mutating methods |
| `/api/v1/widget/…` | Header `x-widget-token` |
| `/api/v1/webhooks/…` | Provider signature / bearer |
| `/api/v1/public/…` | None (published KB only) |
| `/health`, `/internal` | No session. TLS-ask is not a public product API |

Widget CORS is mounted **before** dashboard CORS so customer origins are not rejected by the dashboard allowlist.

JSON limit 256 KB. Inbound webhook raw body limit 2 MB.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | Creates user + workspace + Admin + session |
| POST | `/auth/login` | Same error for unknown email and bad password; Argon2 always runs |
| POST | `/auth/logout` | Revokes session server-side |
| GET | `/auth/me` | Current user + memberships |
| POST | `/invitations/:token/accept` | Join workspace |

## Workspace-scoped (member unless noted)

Mounted under `/workspaces/:workspaceId/`.

- Inbox: conversations, messages, read, email-reply, AI summary
- Contacts, members, invitations (Admin for some writes)
- KB categories/articles, publish/unpublish
- Custom domains (Admin)
- Embed tokens

List endpoints are cursor-paginated (`items` + `nextCursor`), keyset not offset.

## Widget

| Method | Path |
|---|---|
| POST | `/widget/session` |
| GET | `/widget/conversations` |
| GET/POST | `/widget/conversations/:id/messages` (`:id` may be `new` on first send) |
| POST | `/widget/conversations/:id/read` |
| GET | `/widget/suggestions` |

## Webhooks

| POST | `/webhooks/email/inbound` |
| POST | `/webhooks/email/events` |

Always acknowledge unroutable inbound with 2xx so the provider does not retry forever. Invalid signatures are 401.
