# Deploy

## Backend (one VM)

`docker compose up -d --build` is the deploy. On the VM, `COMPOSE_FILE=compose.yaml:compose.prod.yaml:compose.caddy.yaml` adds restart policies, resource limits, and Caddy on 80/443. `migrate` must finish before `api` starts (`depends_on: service_completed_successfully`).

Image builds on the VM; a deploy briefly competes with Postgres for RAM. Swap covers a 1 vCPU box.

Env is validated at process start (`apps/api/src/env.ts`). Missing required values refuse to boot.

Health: Compose and Caddy should use `/health/ready`.

Graceful shutdown: SIGTERM stops the HTTP server (10s bound), closes Socket.IO, disconnects Prisma/Redis. The worker closes BullMQ workers before quitting so an in-flight job is not duplicated.

## Frontend

Cloudflare Pages builds `apps/dashboard` (and demo/widget assets) on git push. Build-time:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WS_URL`
- `NEXT_PUBLIC_WIDGET_ASSET_URL`

The dashboard **must** be a subdomain of the API’s apex (`app.example.com` → `api.example.com`) or session cookies will not send.

## Caddy

Caddy is the edge: TLS for `gigachad-api.devjs.in`, `gigachad-kb.devjs.in`, and customer knowledge-base hostnames. The `Caddyfile` uses `on_demand_tls` with `ask http://api:3000/internal/tls/ask`. That route returns 200 only for a `custom_domains` row with status `VERIFIED`, so DNS verification in the dashboard is what gates HTTPS. Unverified or unknown hostnames never get a certificate.

Customer CNAMEs to `KB_CNAME_TARGET` must be DNS-only if they use a proxying CDN, or the HTTP-01 challenge is intercepted and issuance fails.

## Redis adapter

Wired on day one so a second API replica would fan out emits. It is untested under multiple instances on this assignment deploy (single app container).
