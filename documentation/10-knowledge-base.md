# Knowledge base and custom domains

## Dashboard

Agents write articles (title, slug, category, HTML body). Category filters on the list/editor use a native `<select>` (`NativeSelect`) so HeroUI collection selects do not crash on sentinel values.

HTML is sanitized on write (`sanitizeArticleHtml`). `body_text` is a tag-stripped copy used for search so queries do not match markup.

Lifecycle: `DRAFT` → publish → `PUBLISHED`. Unpublish is the removal path; there is no hard delete.

## Public site

Eta templates in `apps/api/src/kb-web/`. Two ways to resolve a workspace:

1. Path: `GET /api/v1/public/:workspaceSlug/kb` and `.../articles/:articleSlug`
2. Host header: verified `custom_domains` hostname, served by the same templates (empty kb root)

Plain-text interpolations go through `escapeHtml`. Article HTML is the already-sanitized `bodyHtml`.

Search: Postgres full-text on published articles. Widget suggestions also use `pg_trgm` so mid-word prefixes hit.

Drafts are not on any public route.

## Custom domains

This path is live. HTTPS for a customer knowledge base is issued by **Caddy**, not by a separate TLS product.

1. Admin adds a hostname on **Domains**.
2. They point a `CNAME` at `KB_CNAME_TARGET` and a `TXT` at `_gigachad.<hostname>` with the token the dashboard shows.
3. **Verify** checks DNS. Status becomes `VERIFIED`.
4. The next HTTPS handshake for that host hits Caddy’s catch-all `https://` site. Caddy asks `GET /internal/tls/ask?domain=…`. The API returns 200 only for `VERIFIED` rows. Caddy then obtains a Let’s Encrypt certificate and reverse-proxies to the same public KB handlers (workspace resolved from the `Host` header).

Unverified, unknown, localhost, IP literals, and private suffixes are refused — they never get a certificate. Platform hosts (`gigachad-kb.devjs.in`) are named site blocks, not the on-demand catch-all.

Let’s Encrypt rate limits per hostname are a known volume limit; a paid custom-hostname product is the scale-up path.
