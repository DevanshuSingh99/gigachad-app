import { Router } from 'express';
import { patchMemberInput, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { membershipOf, requireAdmin, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams } from '../../middleware/validate';
import * as service from './service';

/**
 * mergeParams is required: this router is mounted under
 * /workspaces/:workspaceId/members, and both the auth context and every query
 * below take the workspace id from that param.
 */
export const membersRouter = Router({ mergeParams: true });

const memberParams = z.object({ workspaceId: uuid, memberId: uuid });

/** Any member can see the team. */
membersRouter.get('/', requireMember, async (req, res) => {
  res.json({ data: await service.listMembers(membershipOf(req)) });
});

/** Admin-only: Agents cannot change roles or remove people (docs/02-product-flows.md). */
membersRouter.patch('/:memberId', requireAdmin, async (req, res) => {
  const { memberId } = parseParams(req, memberParams);
  const { role } = parseBody(req, patchMemberInput);
  res.json({ data: await service.setRole(membershipOf(req), memberId, role) });
});

membersRouter.delete('/:memberId', requireAdmin, async (req, res) => {
  const { memberId } = parseParams(req, memberParams);
  await service.removeMember(membershipOf(req), memberId);
  res.status(204).end();
});
