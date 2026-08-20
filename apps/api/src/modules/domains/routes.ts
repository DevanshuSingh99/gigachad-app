import { Router } from 'express';
import { addDomainInput, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { membershipOf, requireAdmin } from '../../middleware/requireAuth';
import { parseBody, parseParams } from '../../middleware/validate';
import { rateLimit } from '../../lib/rateLimit';
import * as service from './service';

/** Mounted under /workspaces/:workspaceId/domains (mergeParams from workspaces router). */
export const domainsRouter = Router({ mergeParams: true });

const domainParams = z.object({ workspaceId: uuid, domainId: uuid });

domainsRouter.get('/', requireAdmin, async (req, res) => {
  res.json({ data: await service.listDomains(membershipOf(req)) });
});

domainsRouter.post('/', requireAdmin, async (req, res) => {
  const input = parseBody(req, addDomainInput);
  res.status(201).json({ data: await service.addDomain(membershipOf(req), input) });
});

domainsRouter.post(
  '/:domainId/verify',
  requireAdmin,
  rateLimit('domainVerify', (req) => membershipOf(req).workspaceId),
  async (req, res) => {
    const { domainId } = parseParams(req, domainParams);
    res.json({ data: await service.verifyDomain(membershipOf(req), domainId) });
  },
);

domainsRouter.delete('/:domainId', requireAdmin, async (req, res) => {
  const { domainId } = parseParams(req, domainParams);
  await service.deleteDomain(membershipOf(req), domainId);
  res.status(204).end();
});
