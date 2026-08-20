import type { ContactDetailDto, ContactDto, ContactListQuery, PatchContactInput } from '@gigachad/shared';
import type { Page } from '@gigachad/shared';

import { decodeCursor, requireFound, takeWithLookahead, toPage, type WorkspaceScope } from '../../lib/repo';
import { z } from 'zod';
import { contactDetailDto, contactDto } from './dto';
import * as repo from './repo';

const contactCursor = z.object({ v: z.literal(1), lastSeenAt: z.string(), id: z.string() });

function toBeforeCursor(c: { lastSeenAt: string; id: string }) {
  return { lastSeenAt: new Date(c.lastSeenAt), id: c.id };
}

export async function listContacts(
  scope: WorkspaceScope,
  query: ContactListQuery,
): Promise<Page<ContactDto>> {
  const before = query.cursor
    ? toBeforeCursor(decodeCursor(query.cursor, contactCursor))
    : undefined;

  const rows = await repo.listContacts(scope, {
    search: query.search,
    take: takeWithLookahead(query.limit),
    before,
  });

  return toPage(
    rows,
    query.limit,
    contactDto,
    (row) => ({ lastSeenAt: row.lastSeenAt.toISOString(), id: row.id }),
  );
}

export async function getContact(scope: WorkspaceScope, contactId: string): Promise<ContactDetailDto> {
  const contact = requireFound(await repo.findContact(scope, contactId), 'contact');
  const conversations = await repo.listConversationSummariesForContact(scope, contactId);
  return contactDetailDto(contact, conversations);
}

export async function patchContact(
  scope: WorkspaceScope,
  contactId: string,
  input: PatchContactInput,
): Promise<ContactDto> {
  requireFound(await repo.findContact(scope, contactId), 'contact');
  const updated = await repo.updateContact(scope, contactId, input);
  return contactDto(updated);
}
