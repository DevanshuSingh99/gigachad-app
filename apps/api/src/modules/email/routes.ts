import { Router } from 'express';
import express from 'express';

import { CAPS } from '@gigachad/shared';
import { rateLimit } from '../../lib/rateLimit';
import { logger } from '../../lib/logger';
import * as service from './service';

/**
 * Webhook routes for the email channel.
 *
 * These are mounted BEFORE the dashboard JSON body parser in app.ts so they
 * can read the raw body for HMAC signature verification (invariant: sign the
 * exact bytes Brevo sent, not a re-serialized object).
 *
 * Body parsing: express.raw() at 2 MB cap (CAPS.inboundEmailBytes). The JSON
 * is then parsed manually inside the service after signature verification.
 *
 * Auth: provider HMAC signature. No session cookie, no widget token.
 */
export const emailWebhookRouter = Router();

const rawBody = express.raw({ type: '*/*', limit: CAPS.inboundEmailBytes });

/**
 * Inbound email ingestion.
 *
 * Brevo delivers every email addressed to the inbound domain here.
 * The exact path must match what is registered in the Brevo console:
 *   POST /api/v1/webhooks/email/inbound
 *
 * Returns 2xx always unless the signature is invalid — the provider must not
 * retry an unroutable email forever (docs/07-email.md).
 */
emailWebhookRouter.post(
  '/email/inbound',
  rawBody,
  // Layered limits: the global bucket caps total load regardless of source
  // diversity; the per-IP bucket (defaults to `byIp`, see lib/rateLimit.ts)
  // stops a single attacker from exhausting that shared global budget for
  // every legitimate sender.
  rateLimit('inboundWebhook', () => 'global'),
  rateLimit('inboundWebhookPerIp'),
  async (req, res) => {
    const signature = (req.headers['x-sib-webhook-signature'] as string) ?? '';
    const rawBodyBuf = req.body as Buffer;

    const result = await service.ingestInboundEmail(rawBodyBuf, signature);

    if (result === null) {
      // Unroutable recipient — already logged at warn inside the service.
      res.json({ data: { accepted: true, routed: false } });
      return;
    }

    logger.info(
      {
        conversationId: result.conversationId,
        messageId: result.message.id,
        isNewConversation: result.isNewConversation,
      },
      'inbound email ingested',
    );

    res.json({ data: { accepted: true, routed: true, conversationId: result.conversationId } });
  },
);

/**
 * Delivery-status events.
 *
 * Brevo calls this for every state transition (sent, delivered, bounced, etc.).
 * The handler updates the EmailMessage's deliveryStatus in place.
 *
 * Path: POST /api/v1/webhooks/email/events
 */
emailWebhookRouter.post(
  '/email/events',
  rawBody,
  rateLimit('inboundWebhook', () => 'global'),
  rateLimit('inboundWebhookPerIp'),
  async (req, res) => {
    const signature = (req.headers['x-sib-webhook-signature'] as string) ?? '';
    await service.handleDeliveryEvent(req.body as Buffer, signature);
    res.json({ data: { accepted: true } });
  },
);
