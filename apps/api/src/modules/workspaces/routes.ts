import { Router } from 'express';
import { createWorkspaceInput, patchWorkspaceInput, uuid } from '@gigachad/shared';

import { authOf, membershipOf, requireAdmin, requireAuth, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams } from '../../middleware/validate';
import { membershipDto } from '../auth/dto';
import * as authRepo from '../auth/repo';
import { contactsRouter } from '../contacts/routes';
import { conversationsRouter } from '../conversations/routes';
import { invitationsRouter } from '../invitations/routes';
import { membersRouter } from '../members/routes';
import * as service from './service';
import { z } from 'zod';

export const workspacesRouter = Router();

const workspaceParams = z.object({ workspaceId: uuid });

/** A user's own memberships. Cross-workspace by definition, and scoped to them. */
workspacesRouter.get('/', requireAuth, async (req, res) => {
  const memberships = await authRepo.listMembershipsForUser(authOf(req).userId);
  res.json({ data: memberships.map(membershipDto) });
});

/** Any signed-in user can create another workspace and becomes its Admin. */
workspacesRouter.post('/', requireAuth, async (req, res) => {
  const { name } = parseBody(req, createWorkspaceInput);
  const workspace = await service.createWorkspaceForUser(authOf(req).userId, name);
  res.status(201).json({ data: workspace });
});

workspacesRouter.get('/:workspaceId', requireMember, async (req, res) => {
  parseParams(req, workspaceParams);
  res.json({ data: await service.getWorkspace(membershipOf(req)) });
});

/** Admin-only: workspace settings are an Admin concern (docs/02-product-flows.md). */
workspacesRouter.patch('/:workspaceId', requireAdmin, async (req, res) => {
  parseParams(req, workspaceParams);
  const input = parseBody(req, patchWorkspaceInput);
  res.json({ data: await service.patchWorkspace(membershipOf(req), input) });
});

/**
 * Nested routers need mergeParams so :workspaceId is visible to their guards —
 * the auth context resolves membership from that exact param.
 */
workspacesRouter.use('/:workspaceId/members', membersRouter);
workspacesRouter.use('/:workspaceId/invitations', invitationsRouter);
workspacesRouter.use('/:workspaceId/contacts', contactsRouter);
workspacesRouter.use('/:workspaceId/conversations', conversationsRouter);
