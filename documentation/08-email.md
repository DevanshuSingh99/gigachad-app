# Email

Outbound: Nodemailer SMTP (`SMTP_HOST`, typically Brevo relay). Inbound: HTTP webhook from the inbound parser (Brevo), not IMAP.

## Addressing

Each workspace stores `support_address` as `<slug>@<INBOUND_EMAIL_DOMAIN>` (for example `acme@inbound.example.com` when `INBOUND_EMAIL_DOMAIN=inbound.example.com`). Outbound `Reply-To` is that address so customer replies come back to us. `From` is `EMAIL_FROM` / `MAIL_FROM` on the authenticated sending domain (not the inbound subdomain).

Operator DNS (not in this repo): SPF/DKIM on the sending domain, MX for `inbound.*` to the provider, webhook URLs:

- `POST /api/v1/webhooks/email/inbound`
- `POST /api/v1/webhooks/email/events`

## Inbound pipeline

1. Verify signature (and reject stale timestamps) **before** persist, when email is enabled.
2. Dedup on provider event id (`idempotency_keys` / `email_messages.provider_event_id`).
3. Resolve workspace from the recipient local part (slug). Unknown recipient → 2xx, no row.
4. Canonical body is `text/plain`. HTML is sanitized with the chat allowlist.
5. Thread match, in order: `In-Reply-To` → `References` → `Thread-Index`. **Not** subject.
6. One transaction: allocate sequence (reopens resolved/snoozed on customer mail), insert `messages` + `email_messages`, upsert `email_threads`.
7. Emit socket events.

`References` stored on the thread is bounded: first Message-ID plus the last eight.

## Outbound

Dashboard `POST .../email-reply` writes the message as `PENDING`, then enqueues `email-send`. The worker sets RFC `Message-ID`, `In-Reply-To`, `References`, sends, then mirrors `SENT` / `FAILED` onto both email and inbox rows. Delivery webhooks later map bounce/delivered.

Retries: three BullMQ attempts, exponential backoff. Exhausted jobs mark `FAILED`.
