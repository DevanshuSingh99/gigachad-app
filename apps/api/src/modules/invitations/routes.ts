import { Router } from 'express';
import { acceptInvitationInput, createInvitationInput, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { getAuthContext } from '../../lib/authContext';
import { rateLimit } from '../../lib/rateLimit';
import { issueSessionCookies } from '../../lib/sessions';
import { authOf, membershipOf, requireAdmin } from '../../middleware/requireAuth';
import { parseBody, parseParams } from '../../middleware/validate';
import * as service from './service';

/** Workspace-scoped: mounted under /workspaces/:workspaceId/invitations. */
export const invitationsRouter = Router({ mergeParams: true });

invitationsRouter.get('/', requireAdmin, async (req, res) => {
  res.json({ data: await service.listInvitations(membershipOf(req)) });
});

invitationsRouter.post(
  '/',
  requireAdmin,
  // Keyed per workspace, so one tenant cannot exhaust the limit for others.
  rateLimit('invitationCreate', (req) => (req.params as { workspaceId?: string }).workspaceId ?? null),
  async (req, res) => {
    parseParams(req, z.object({ workspaceId: uuid }));
    const input = parseBody(req, createInvitationInput);
    const invitation = await service.createInvitation(
      membershipOf(req),
      authOf(req).userId,
      input,
    );
    res.status(201).json({ data: invitation });
  },
);

/**
 * Public: mounted at /api/v1/invitations. Works signed-out and signed-in, and the
 * token in the path is the only credential — so both routes are rate-limited per
 * IP to make guessing pointless rather than merely slow.
 */
export const invitationAcceptRouter = Router();

const tokenParams = z.object({ token: z.string().min(10).max(200) });

/**
 * Preview, so the accept screen can name the workspace and role before anyone
 * commits. Not in the route list in docs/05-api.md; added because the alternative
 * is asking a recipient to accept an invitation that does not say what it is for.
 * It reveals only what the invitation email already told them.
 */
invitationAcceptRouter.get('/:token', rateLimit('invitationAccept'), async (req, res) => {
  const { token } = parseParams(req, tokenParams);
  res.json({ data: await service.previewInvitation(token) });
});

invitationAcceptRouter.post('/:token/accept', rateLimit('invitationAccept'), async (req, res) => {
  const { token } = parseParams(req, tokenParams);
  const input = parseBody(req, acceptInvitationInput);

  // A signed-in caller accepts as themselves; the service enforces that their
  // address matches the invited one.
  const auth = await getAuthContext(req);
  const result = await service.acceptInvitation(token, input, auth?.user ?? null);

  if (result.session) issueSessionCookies(res, result.session);
  res.json({ data: result.me });
});
