# Pending Setup & Testing Tasks

Items to complete before/during deployment. None of these block further development.

---

## Email Channel (Phase E)

### Brevo — Inbound Setup
- [ ] Add MX records for `inbound.<yourdomain>` pointing at Brevo's inbound hosts
- [ ] Register inbound webhook in Brevo console:
      `POST https://<api-host>/api/v1/webhooks/email/inbound`
- [ ] Copy signing secret from Brevo webhook settings
- [ ] Register delivery events webhook:
      `POST https://<api-host>/api/v1/webhooks/email/events`

### Environment Variables to add
```env
INBOUND_EMAIL_DOMAIN=inbound.<yourdomain>
BREVO_WEBHOOK_SIGNING_SECRET=<from-brevo-console>
```

### SMTP outbound
```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<your-brevo-smtp-user>
SMTP_PASS=<your-brevo-smtp-password>
EMAIL_FROM=Your Name <you@yourdomain.com>
```
**A real SMTP username/password and a real Gmail address were previously
committed to this file in plaintext and have been redacted above.** Treat
those credentials as compromised — rotate the Brevo SMTP password in the
Brevo console before relying on this environment again, and never paste real
secrets into a tracked or shareable file; put them directly in `.env` (which
is gitignored) instead.

### Testing checklist
- [ ] Send a real email to `<workspace-slug>@inbound.<yourdomain>` → appears as EMAIL conversation in inbox
- [ ] Reply from dashboard → email lands in customer inbox with correct `Reply-To`
- [ ] Reply to that email → threads into same conversation (not a new one)
- [ ] Send duplicate webhook → only one message created
- [ ] Send with forged/missing signature → rejected (once `BREVO_WEBHOOK_SIGNING_SECRET` is set)

---

## Knowledge Base (Phase F)

### Known Bug — KB Article Editor/List React Error
- [ ] "Objects are not valid as a React child" error on `/kb/{articleId}` and `/kb`
- Suspected cause: HeroUI `Select` / `SelectItem` collection system with sentinel keys
- Attempted fixes: removed `key=""`, replaced with `key="__none__"` / `key="__all__"` sentinels — error persists
- May need: replace HeroUI `Select` with native `<select>` elements on KB pages, or investigate HeroUI version-specific collection bug
- Reproduce: create a new article → redirected to editor → error overlay appears

### Testing checklist
- [ ] Create a category, create an article, publish it
- [ ] Verify draft is NOT reachable at `GET /api/v1/public/:slug/kb/articles/:slug`
- [ ] Verify published article IS reachable and renders HTML
- [ ] Test full-text search: `GET /api/v1/public/:slug/kb?search=<query>`
- [ ] Test widget suggestions mid-word (e.g. type "refun" → returns refund article)
- [ ] Paste a `<script>` tag into article body → verify it is stripped in the stored HTML

---

## AI Summaries (Phase G — not yet built)
- [ ] Set `OPENAI_API_KEY` in `.env` when ready to test
- [ ] Verify AI summary path works end-to-end on a 6+ message conversation

---

## Deployment (Phase K)
- [ ] Fill remaining `.env` values: `KB_HOST`, `KB_CNAME_TARGET`, `COOKIE_DOMAIN`, `API_URL`, `DASHBOARD_ORIGIN`
- [ ] Run `docker compose up -d --build` on the VM
- [ ] Confirm `migrate` service completed before `api` started
- [ ] Check both health endpoints: `GET /health/live` and `GET /health/ready`
- [ ] Confirm Pages deployments for dashboard and demo are current
- [ ] Point Brevo webhooks at production URLs and run inbound email end-to-end
- [ ] Tag commit as known-good for rollback

---

## Submission (Phase L)
- [ ] Fill every `TODO` in README: live URLs, M1–M7 status checkboxes
- [ ] Verify no secrets or `.env` files are committed
- [ ] Send links to Aditya at `+91 9717115749`
- [ ] Email `aditya@superprofile.bio`, CC `vp@superprofile.bio`
