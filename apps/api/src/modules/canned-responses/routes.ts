import { Router } from 'express';
import {
  cannedResponseListQuery,
  cannedResponseParams,
  createCannedResponseInput,
  patchCannedResponseInput,
} from '@gigachad/shared';

import { authOf, membershipOf, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import * as service from './service';

/**
 * Canned-response routes, mounted under /workspaces/:workspaceId/canned-responses
 * by the workspaces router. mergeParams is set so :workspaceId is visible to auth.
 * All operations are available to any workspace member (Admins and Agents).
 */
export const cannedResponsesRouter = Router({ mergeParams: true });

cannedResponsesRouter.get('/', requireMember, async (req, res) => {
  const query = parseQuery(req, cannedResponseListQuery);
  res.json({ data: await service.listCannedResponses(membershipOf(req), query) });
});

cannedResponsesRouter.post('/', requireMember, async (req, res) => {
  const input = parseBody(req, createCannedResponseInput);
  res.status(201).json({
    data: await service.createCannedResponse(membershipOf(req), input, authOf(req).userId),
  });
});

cannedResponsesRouter.get('/:responseId', requireMember, async (req, res) => {
  const { responseId } = parseParams(req, cannedResponseParams);
  res.json({ data: await service.getCannedResponse(membershipOf(req), responseId) });
});

cannedResponsesRouter.patch('/:responseId', requireMember, async (req, res) => {
  const { responseId } = parseParams(req, cannedResponseParams);
  const input = parseBody(req, patchCannedResponseInput);
  res.json({ data: await service.patchCannedResponse(membershipOf(req), responseId, input) });
});

cannedResponsesRouter.delete('/:responseId', requireMember, async (req, res) => {
  const { responseId } = parseParams(req, cannedResponseParams);
  await service.deleteCannedResponse(membershipOf(req), responseId);
  res.status(204).end();
});
