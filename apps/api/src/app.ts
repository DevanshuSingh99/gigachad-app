import path from 'node:path';

import cookieParser from 'cookie-parser';
import express, { type Express, type NextFunction, type Request, type Response, Router } from 'express';
import { CAPS, TIMEOUTS } from '@gigachad/shared';

import { corsMiddleware, widgetCors } from './middleware/cors';
import { csrfMiddleware } from './middleware/csrf';
import { errorMiddleware, notFoundMiddleware } from './middleware/error';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLogMiddleware } from './middleware/requestLog';
import { secureHeadersMiddleware } from './middleware/secureHeaders';
import { healthRouter } from './internal/health';
import { tlsAskRouter } from './internal/tlsAsk';
import { authRouter } from './modules/auth/routes';
import { invitationAcceptRouter } from './modules/invitations/routes';
import { widgetRouter } from './modules/widget/routes';
import { workspacesRouter } from './modules/workspaces/routes';
import { emailWebhookRouter } from './modules/email/routes';
import { platformHostnames } from './modules/domains/service';
import { customDomainKbRouter, publicKbRouter } from './modules/kb/public';

/**
 * Aborts a request that's been open too long — the one limit in
 * docs/16-errors-and-limits.md's caps table with no enforcement anywhere
 * (Phase I hardening audit). A hung downstream call (DNS lookup, provider
 * webhook, stalled client upload) would otherwise hold a handler open
 * indefinitely on the single-vCPU box this is deployed to.
 */
function timeoutMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.setTimeout(TIMEOUTS.httpHandlerMs, () => {
    if (!res.headersSent) res.status(503).json({ error: { code: 'INTERNAL', message: 'Request timed out.' } });
  });
  next();
}

/**
 * Express application assembly. Order matters and is the reason this lives in one
 * readable file rather than being spread across modules:
 *
 *   requestId → cookies → CORS → body parsing → routes → 404 → error
 *
 * Body parsing is mounted per-router rather than globally so the inbound email
 * webhook can take a raw body at a 2 MB cap for signature verification, while
 * everything else takes JSON at 256 KB.
 */
export function createApp(): Express {
  const app = express();

  // Behind Caddy. One hop, so a client cannot forge X-Forwarded-For and defeat
  // the per-IP rate limits.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(requestIdMiddleware);
  app.use(timeoutMiddleware);
  app.use(secureHeadersMiddleware);
  app.use(cookieParser());
  app.use(requestLogMiddleware);

  // Widget namespace mounted BEFORE the dashboard's CORS, with its own permissive
  // CORS and JSON parser. Order is load-bearing: Express runs middleware in
  // registration order, so if the dashboard's strict, credentialed CORS ran
  // first it would reject every widget request's Origin before this router ever
  // saw it. See middleware/cors.ts's widgetCors for why the widget namespace
  // cannot share the dashboard's CORS at all.
  const widgetV1 = Router();
  widgetV1.use(widgetCors);
  widgetV1.use(express.json({ limit: CAPS.jsonBodyBytes }));
  widgetV1.use(widgetRouter);
  app.use('/api/v1/widget', widgetV1);

  // Everything below is the dashboard-facing surface: strict, credentialed,
  // explicit-origin CORS, applied once here rather than per-router.
  app.use(corsMiddleware());
  app.use(csrfMiddleware);

  app.use('/health', healthRouter);
  app.use('/internal', tlsAskRouter);

  // Webhook routes use express.raw() internally (signature verification over the
  // raw bytes), so they must be mounted before the JSON body parser below.
  app.use('/api/v1/webhooks', emailWebhookRouter);

  const apiV1 = Router();
  apiV1.use(express.json({ limit: CAPS.jsonBodyBytes }));

  apiV1.use('/auth', authRouter);
  apiV1.use('/workspaces', workspacesRouter);
  apiV1.use('/invitations', invitationAcceptRouter);

  // The KB stylesheet the public templates link to (apps/api/src/kb-web/layout.eta).
  // "assets" is reserved (packages/shared's RESERVED_SLUGS) so it can never collide
  // with publicKbRouter's `/:workspaceSlug/kb` pattern below. Same __dirname-relative
  // path public.ts's Eta `views` option uses, so this resolves correctly whether
  // running from src/ (dev, tsx) or dist/ (prod, after copy-assets + build:css) —
  // in dev the compiled stylesheet doesn't exist yet and this 404s harmlessly, since
  // the KB layout keeps an inline <style> fallback for exactly that case.
  apiV1.use(
    '/public/assets/kb',
    express.static(path.join(__dirname, 'kb-web'), { index: false, extensions: [] }),
  );
  apiV1.use('/public', publicKbRouter);

  app.use('/api/v1', apiV1);

  // Custom-domain KB (Phase H): a request whose Host header is neither the
  // API's own host nor the dashboard/KB platform hosts might be a verified
  // customer domain — hand it to the Host-header resolver, which 404s on
  // anything not actually VERIFIED. Requests to the platform's own hosts skip
  // this entirely and fall through to notFoundMiddleware as before, so this
  // can never shadow a real route (the router only answers `/` and
  // `/articles/:slug`, paths this app has no other handler for regardless).
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    if (!host || platformHostnames().has(host)) {
      next();
      return;
    }
    customDomainKbRouter(req, res, next);
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
