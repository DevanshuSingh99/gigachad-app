import { db, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

const CONTACT_SELECT = {
  id: true,
  name: true,
  email: true,
  externalKey: true,
  identitySource: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

export function listContacts(
  scope: WorkspaceScope,
  opts: { search?: string; take: number; before?: { lastSeenAt: Date; id: string } },
) {
  return db.contact.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(opts.search
        ? {
            OR: [
              { name: { contains: opts.search, mode: 'insensitive' as const } },
              { email: { contains: opts.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(opts.before
        ? {
            OR: [
              { lastSeenAt: { lt: opts.before.lastSeenAt } },
              { lastSeenAt: opts.before.lastSeenAt, id: { lt: opts.before.id } },
            ],
          }
        : {}),
    },
    select: CONTACT_SELECT,
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    take: opts.take,
  });
}

export function findContact(scope: WorkspaceScope, contactId: string) {
  return db.contact.findFirst({
    where: { id: contactId, workspaceId: scope.workspaceId },
    select: CONTACT_SELECT,
  });
}

export function listConversationSummariesForContact(scope: WorkspaceScope, contactId: string) {
  return db.conversation.findMany({
    where: { workspaceId: scope.workspaceId, contactId },
    select: { id: true, channel: true, status: true, lastMessageAt: true },
    orderBy: { lastMessageAt: 'desc' },
    take: 25,
  });
}

export function updateContact(
  scope: WorkspaceScope,
  contactId: string,
  data: { name?: string | null; email?: string | null },
) {
  return db.contact.update({
    where: { id: contactId, workspaceId: scope.workspaceId },
    data,
    select: CONTACT_SELECT,
  });
}

/**
 * Finds or creates a contact by normalized email, or creates a fresh anonymous
 * one when no email is given.
 *
 * There is deliberately no public "create contact" route (docs/05-api.md):
 * contacts are meant to come from channel ingestion — a widget session (Phase D)
 * or an inbound email (Phase E). This function is what those will call; for now
 * it is exercised by the local-only seed script so Phase C has something to seed.
 */
export async function findOrCreateContact(
  client: Tx,
  scope: WorkspaceScope,
  data: { email?: string; name?: string; externalKey?: string; identitySource: 'EMAIL' | 'WIDGET' },
) {
  // Raw SQL, not Prisma's typed upsert: `contacts_workspace_email_key` is a
  // partial unique index (`WHERE email IS NOT NULL`, prisma/migrations/...),
  // which Prisma has no syntax for and so cannot see as a `@@unique` target.
  // This is a real atomic `INSERT ... ON CONFLICT DO UPDATE` against that
  // index — two concurrent widget sessions (or a widget session racing an
  // inbound email) for the same brand-new address resolve to one Contact row
  // instead of racing a find-then-create into a duplicate.
  if (data.email) {
    const rows = await client.$queryRaw<
      Array<{
        id: string;
        name: string | null;
        email: string | null;
        externalKey: string | null;
        identitySource: 'EMAIL' | 'WIDGET';
        lastSeenAt: Date;
        createdAt: Date;
      }>
    >`
      INSERT INTO contacts (id, workspace_id, email, name, external_key, identity_source, created_at, updated_at, last_seen_at)
      VALUES (gen_random_uuid(), ${scope.workspaceId}::uuid, ${data.email}, ${data.name ?? null}, ${data.externalKey ?? null}, ${data.identitySource}::"IdentitySource", now(), now(), now())
      ON CONFLICT (workspace_id, email) WHERE email IS NOT NULL
        DO UPDATE SET email = EXCLUDED.email
      RETURNING id, name, email, external_key AS "externalKey", identity_source AS "identitySource", last_seen_at AS "lastSeenAt", created_at AS "createdAt"
    `;
    return rows[0]!;
  }

  return client.contact.create({
    data: {
      workspaceId: scope.workspaceId,
      email: data.email,
      name: data.name,
      externalKey: data.externalKey,
      identitySource: data.identitySource,
    },
    select: CONTACT_SELECT,
  });
}
