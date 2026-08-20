import { Router } from 'express';
import { conversationListQuery, createConversationInput, emailReplyInput, patchConversationInput, readInput, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { authOf, membershipOf, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { messagesRouter } from '../messages/routes';
import * as aiService from '../ai/service';
import * as emailService from '../email/service';
import * as service from './service';

/** Workspace-scoped: mounted under /workspaces/:workspaceId/conversations. */
export const conversationsRouter = Router({ mergeParams: true });

const conversationParams = z.object({ workspaceId: uuid, conversationId: uuid });

conversationsRouter.get('/', requireMember, async (req, res) => {
  const query = parseQuery(req, conversationListQuery);
  res.json({ data: await service.listConversations(membershipOf(req), query) });
});

conversationsRouter.post('/', requireMember, async (req, res) => {
  const input = parseBody(req, createConversationInput);
  res.status(201).json({ data: await service.createConversation(membershipOf(req), input) });
});

conversationsRouter.get('/:conversationId', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, conversationParams);
  res.json({ data: await service.getConversation(membershipOf(req), conversationId) });
});

conversationsRouter.patch('/:conversationId', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, conversationParams);
  const input = parseBody(req, patchConversationInput);
  res.json({
    data: await service.patchConversation(membershipOf(req), conversationId, input, authOf(req).userId),
  });
});

conversationsRouter.post('/:conversationId/read', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, conversationParams);
  const input = parseBody(req, readInput);
  res.json({ data: await service.markConversationRead(membershipOf(req), conversationId, input) });
});

conversationsRouter.post('/:conversationId/email-reply', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, conversationParams);
  const input = parseBody(req, emailReplyInput);
  res.status(201).json({
    data: await emailService.createEmailReply(
      membershipOf(req),
      conversationId,
      input,
      authOf(req).userId,
    ),
  });
});

conversationsRouter.get('/:conversationId/summary', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, conversationParams);
  res.json({ data: await aiService.getSummary(membershipOf(req), conversationId) });
});

conversationsRouter.post('/:conversationId/summary', requireMember, async (req, res) => {
  const { conversationId } = parseParams(req, conversationParams);
  res.json({ data: await aiService.triggerSummary(membershipOf(req), conversationId) });
});

conversationsRouter.use('/:conversationId/messages', messagesRouter);
