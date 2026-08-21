# Widget

Two bundles:

- **Loader** (`apps/widget/src/loader.ts`) — small script on the customer page. Creates the iframe, posts init, relays height. Session creation happens **here** so `fetch` carries the host page’s `Origin`.
- **Panel** (`apps/widget/src/panel/`) — chat UI inside the iframe. Socket.IO, composer, suggestions, offline outbox.

The iframe keeps customer CSS from breaking the panel and keeps a sanitizer miss off the host page.

## Keys

- Workspace key: `wk_live_…` stored on `workspaces.widget_key`. Allowed origins come from workspace settings (`allowedWidgetOrigins`).
- Embed token: `wk_embed_…` in `embed_tokens`. One origin per token. Admins mint these on the dashboard embed screen.

Session endpoint returns a visitor token. The panel sends it as `x-widget-token` and as `auth.widgetToken` on the socket.

Clearing site storage creates a new contact. That is documented product behavior, not a bug.

## Loader ↔ panel trust boundary

The loader executes in the host page's real origin, which legitimately varies per install — there is no fixed value the panel could check `event.origin` against on that channel. That means the `init` `postMessage` cannot be authenticated, so the panel never treats anything security-relevant in it as trustworthy: `apiUrl`/`wsUrl` are **not** carried in `init` at all. Both the loader and the panel bake `WIDGET_API_URL`/`WIDGET_WS_URL` in independently at build time (esbuild `define`, `apps/widget/scripts/build.mjs`), so a forged `init` message from a compromised host page can feed the panel a bogus session or `hostPageUrl`, but it cannot redirect the panel's own REST calls or socket connection — and therefore cannot exfiltrate the widget token — to an attacker-controlled endpoint.

## First message

`POST /api/v1/widget/conversations/new/messages` creates (or reuses) the contact’s latest chat conversation. Later sends use the real id over the socket when connected, or REST if offline.

## Suggestions

`GET /api/v1/widget/suggestions?q=` — prefix / trigram search over published articles. Debounced in the panel; rate-limited per widget session.
