import cookieParser from 'cookie-parser';
import express, { type Express, Router } from 'express';
import { CAPS } from '@gigachad/shared';

import { corsMiddleware, widgetCors } from './middleware/cors';
import { errorMiddleware, notFoundMiddleware } from './middleware/error';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLogMiddleware } from './middleware/requestLog';
import { healthRouter } from './internal/health';
import { authRouter } from './modules/auth/routes';
import { invitationAcceptRouter } from './modules/invitations/routes';
import { widgetRouter } from './modules/widget/routes';
import { workspacesRouter } from './modules/workspaces/routes';

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

  app.use('/health', healthRouter);

  // Phase E mounts /api/v1/webhooks ahead of this with its own raw body parser.
  const apiV1 = Router();
  apiV1.use(express.json({ limit: CAPS.jsonBodyBytes }));

  apiV1.use('/auth', authRouter);
  apiV1.use('/workspaces', workspacesRouter);
  apiV1.use('/invitations', invitationAcceptRouter);

  app.use('/api/v1', apiV1);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
