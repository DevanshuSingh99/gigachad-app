import { Router } from 'express';
import { createMessageInput, messageListQuery, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { authOf, membershipOf, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import * as service from './service';

/** Mounted under /workspaces/:workspaceId/conversations/:conversationId/messages. */
export const messagesRouter = Router({ mergeParams: true });

const params = z.object({ workspaceId: uuid, conversationId: uuid });

messagesRouter.get('/', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, params);
  const query = parseQuery(req, messageListQuery);
  res.json({ data: await service.listMessages(membershipOf(req), conversationId, query) });
});

/** Agent send only. Customer send arrives on the widget namespace in Phase D. */
messagesRouter.post('/', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, params);
  const input = parseBody(req, createMessageInput);
  const message = await service.createMessage(membershipOf(req), conversationId, input, {
    type: 'AGENT',
    userId: authOf(req).userId,
  });
  res.status(201).json({ data: message });
});
