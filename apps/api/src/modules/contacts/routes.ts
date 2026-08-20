import { Router } from 'express';
import { contactListQuery, patchContactInput, uuid } from '@gigachad/shared';
import { z } from 'zod';

import { membershipOf, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import * as service from './service';

/** Workspace-scoped: mounted under /workspaces/:workspaceId/contacts. */
export const contactsRouter = Router({ mergeParams: true });

const contactParams = z.object({ workspaceId: uuid, contactId: uuid });

contactsRouter.get('/', requireMember, async (req, res) => {
  const query = parseQuery(req, contactListQuery);
  // { data } on every response, even a paginated list — the page shape
  // ({ items, nextCursor }) nests inside it rather than replacing it.
  res.json({ data: await service.listContacts(membershipOf(req), query) });
});

contactsRouter.get('/:contactId', requireMember, async (req, res) => {
  const { contactId } = parseParams(req, contactParams);
  res.json({ data: await service.getContact(membershipOf(req), contactId) });
});

contactsRouter.patch('/:contactId', requireMember, async (req, res) => {
  const { contactId } = parseParams(req, contactParams);
  const input = parseBody(req, patchContactInput);
  res.json({ data: await service.patchContact(membershipOf(req), contactId, input) });
});
