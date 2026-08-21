# Running locally

## Prerequisites

Docker + Compose. Node 20+ if you run the dashboard outside the API container.

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD, DATABASE_URL, REDIS_URL, SESSION_SECRET (≥32 chars).
# For local cookies leave COOKIE_DOMAIN empty.
# Point API_URL at http://localhost:3000 and DASHBOARD_ORIGIN at http://localhost:3001.
docker compose up -d --build
```

Compose starts Postgres, Redis, a one-shot `migrate` service, then `api` and `worker`. The API is `http://localhost:3000`. Public KB (platform host) is under `/api/v1/public/:workspaceSlug/kb`.

Local Compose uses `compose.override.yaml`: API port 3000, no Caddy.

## Dashboard

```bash
npm install
npm run dev --workspace @gigachad/dashboard
```

Open `http://localhost:3001/signup`. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` (see `apps/dashboard/.env.example`).

Demo / widget: `npm run dev --workspace @gigachad/demo` (http://localhost:5500). For production evaluation, see the root README (hosted demo at `https://gigachad-demo.devjs.in/?key=…`).

## Optional providers

| Missing env | What still works |
|---|---|
| `OPENAI_API_KEY` | Entire product except summaries (`AI_UNAVAILABLE`) |
| `SMTP_HOST` / `EMAIL_FROM` | Chat, KB, auth. Outbound mail fails closed. Inbound webhooks skip signature checks only when email is fully off. |
| `BREVO_WEBHOOK_SIGNING_SECRET` with email on | Inbound is **rejected** (fail closed) |

## Health

- `GET /health/live` — process is up
- `GET /health/ready` — Postgres + Redis respond

## Tests

```bash
npm test
```

Unit tests always run. The HTTP/socket suite needs Postgres and Redis on `127.0.0.1`. If they are down, those cases skip instead of failing the whole command. Details: [13-testing.md](13-testing.md).
