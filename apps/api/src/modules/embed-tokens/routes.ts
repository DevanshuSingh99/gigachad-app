import { Router } from 'express';
import { createEmbedTokenInput, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { membershipOf, requireAdmin } from '../../middleware/requireAuth';
import { parseBody, parseParams } from '../../middleware/validate';
import * as service from './service';

/** Mounted under /workspaces/:workspaceId/embed-tokens (mergeParams from workspaces router). */
export const embedTokensRouter = Router({ mergeParams: true });

const tokenParams = z.object({ workspaceId: uuid, tokenId: uuid });

embedTokensRouter.get('/', requireAdmin, async (req, res) => {
  res.json({ data: await service.listEmbedTokens(membershipOf(req)) });
});

embedTokensRouter.post('/', requireAdmin, async (req, res) => {
  const input = parseBody(req, createEmbedTokenInput);
  res.status(201).json({ data: await service.createEmbedToken(membershipOf(req), input) });
});

/**
 * Revoke (soft-delete) a token. Returns the updated row so the client can
 * update its cache without a refetch.
 */
embedTokensRouter.delete('/:tokenId', requireAdmin, async (req, res) => {
  const { tokenId } = parseParams(req, tokenParams);
  res.json({ data: await service.revokeEmbedToken(membershipOf(req), tokenId) });
});
