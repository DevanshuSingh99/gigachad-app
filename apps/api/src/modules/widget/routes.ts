import { Router } from 'express';
import {
  createMessageInput,
  createWidgetSessionInput,
  messageListQuery,
  readInput,
} from '@gigachad/shared';
import { z } from 'zod';

import { rateLimit } from '../../lib/rateLimit';
import { requireWidget, widgetOf } from '../../middleware/requireWidget';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import * as service from './service';

export const widgetRouter = Router();

/** `widgetKey` doubles as part of the rate-limit key, per docs/16-errors-and-limits.md. */
function ipAndWidgetKey(req: { ip?: string; body?: unknown }): string {
  const body = req.body as { widgetKey?: unknown } | undefined;
  const key = typeof body?.widgetKey === 'string' ? body.widgetKey : 'unknown';
  return `${req.ip ?? 'unknown'}:${key}`;
}

widgetRouter.post('/session', rateLimit('widgetSessionCreate', ipAndWidgetKey), async (req, res) => {
  const input = parseBody(req, createWidgetSessionInput);
  const session = await service.createSession(input, {
    origin: req.headers.origin,
    userAgent: req.header('user-agent'),
  });
  res.status(201).json({ data: session });
});

widgetRouter.get('/conversations', requireWidget, async (req, res) => {
  const { workspaceId, contactId } = widgetOf(req);
  res.json({ data: await service.listConversations({ workspaceId }, contactId) });
});

const conversationParams = z.object({ conversationId: z.string().min(1).max(200) });

widgetRouter.get('/conversations/:conversationId/messages', requireWidget, async (req, res) => {
  const { workspaceId, contactId } = widgetOf(req);
  const { conversationId } = parseParams(req, conversationParams);
  const query = parseQuery(req, messageListQuery);
  res.json({ data: await service.listMessages({ workspaceId }, contactId, conversationId, query) });
});

widgetRouter.post(
  '/conversations/:conversationId/messages',
  requireWidget,
  rateLimit('widgetMessageSend', (req) => widgetOf(req).sessionId),
  async (req, res) => {
    const { workspaceId, contactId } = widgetOf(req);
    const { conversationId } = parseParams(req, conversationParams);
    const input = parseBody(req, createMessageInput);
    const message = await service.sendMessage({ workspaceId }, contactId, conversationId, input);
    res.status(201).json({ data: message });
  },
);

widgetRouter.post('/conversations/:conversationId/read', requireWidget, async (req, res) => {
  const { workspaceId, contactId } = widgetOf(req);
  const { conversationId } = parseParams(req, conversationParams);
  const input = parseBody(req, readInput);
  res.json({ data: await service.markRead({ workspaceId }, contactId, conversationId, input) });
});
