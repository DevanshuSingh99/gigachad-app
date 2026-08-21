import { Router } from 'express';
import { analyticsRangeInput } from '@gigachad/shared';

import { membershipOf, requireAdmin } from '../../middleware/requireAuth';
import { parseQuery } from '../../middleware/validate';
import { rateLimit } from '../../lib/rateLimit';
import * as service from './service';

/**
 * Mounted under /workspaces/:workspaceId/analytics (mergeParams from
 * workspaces router). `requireAdmin` is the real authorization boundary here
 * — Agents get a 403, same guard `members/routes.ts` uses for role changes.
 * The dashboard also hides the nav entry/page for Agents, but that is UX
 * only, not the enforcement (documentation/15-analytics.md).
 */
export const analyticsRouter = Router({ mergeParams: true });

analyticsRouter.get(
  '/overview',
  requireAdmin,
  rateLimit('analyticsRead', (req) => membershipOf(req).workspaceId),
  async (req, res) => {
    const query = parseQuery(req, analyticsRangeInput);
    res.json({ data: await service.getOverview(membershipOf(req), query) });
  },
);
