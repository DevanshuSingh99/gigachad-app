/**
 * Local-only seed data. Never imported by server.ts or worker.ts, and never runs
 * on its own — `npm run seed` is the only way this executes (docs/18-execution.md,
 * Phase C, task 8).
 *
 * Deliberately reuses the real service functions (signup, createConversation,
 * createMessage, patchConversation) rather than hand-crafting rows with Prisma
 * directly. That keeps this script honest: if sequence allocation or the
 * reopen-on-customer-message rule ever breaks, seeding breaks the same way the
 * real API would, instead of quietly working around it.
 *
 * Safe to run more than once — it skips seeding if the demo workspace already
 * exists rather than erroring on duplicate emails/slugs.
 */
import { randomUUID } from 'node:crypto';

import { db } from '../src/db';
import { hashPassword } from '../src/lib/password';
import type { WorkspaceScope } from '../src/lib/repo';
import { findOrCreateContact } from '../src/modules/contacts/repo';
import { createConversation, patchConversation } from '../src/modules/conversations/service';
import { createMessage } from '../src/modules/messages/service';
import { signup } from '../src/modules/auth/service';

const ADMIN_EMAIL = 'demo@example.com';
const ADMIN_PASSWORD = 'demo-password-123';
const AGENT_EMAIL = 'agent-demo@example.com';
const AGENT_NAME = 'Adia Agent';
const WORKSPACE_NAME = 'Demo Support';

async function main() {
  const existing = await db.workspace.findUnique({ where: { slug: 'demo-support' }, select: { id: true } });
  if (existing) {
    console.log(`Workspace 'demo-support' already exists (${existing.id}) — nothing to seed. Delete it to reseed.`);
    return;
  }

  console.log('Creating demo workspace via the real signup flow…');
  const { me } = await signup({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    name: 'Dana Demo',
    workspaceName: WORKSPACE_NAME,
  });
  const adminId = me.user.id;
  const workspaceId = me.memberships[0]!.workspaceId;
  const scope: WorkspaceScope = { workspaceId };
  console.log(`  workspace ${workspaceId}, admin ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);

  // A direct membership insert, not the invite/accept ceremony — Phase B's gate
  // already covers that flow thoroughly; this script only needs a second member
  // to assign conversations to.
  const agent = await db.user.create({
    data: { email: AGENT_EMAIL, passwordHash: await hashPassword(ADMIN_PASSWORD), name: AGENT_NAME },
    select: { id: true, name: true },
  });
  await db.workspaceMember.create({ data: { workspaceId, userId: agent.id, role: 'AGENT' } });
  console.log(`  agent ${AGENT_EMAIL} / ${ADMIN_PASSWORD}`);

  console.log('Creating contacts and conversations…');

  const alex = await findOrCreateContact(db, scope, {
    email: 'alex@customer.test',
    name: 'Alex Customer',
    identitySource: 'WIDGET',
  });
  const bailey = await findOrCreateContact(db, scope, {
    email: 'bailey@customer.test',
    name: 'Bailey Buyer',
    identitySource: 'WIDGET',
  });
  const casey = await findOrCreateContact(db, scope, {
    email: 'casey@customer.test',
    name: 'Casey Client',
    identitySource: 'EMAIL',
  });

  // A fresh UUID per message rather than a per-call index: exchange() is called
  // more than once for the same conversation (e.g. resolve, then one more
  // customer message), and an index that resets to 0 each call would collide
  // with an earlier message's clientMessageId — which the idempotency check
  // would then (correctly) treat as a duplicate retry and silently drop. Found
  // by seeding: the third exchange() call on the "reopen" conversation vanished
  // until this was a real UUID.
  async function exchange(
    conversationId: string,
    turns: Array<{ from: 'CUSTOMER' | 'AGENT'; text: string }>,
  ) {
    for (const turn of turns) {
      await createMessage(
        scope,
        conversationId,
        { bodyText: turn.text, clientMessageId: `seed_${randomUUID()}` },
        turn.from === 'AGENT' ? { type: 'AGENT', userId: adminId } : { type: 'CUSTOMER' },
      );
    }
  }

  // 1. OPEN, unassigned, CHAT — nine messages, past the six-message AI threshold,
  // gapless sequence 1..9 (verify with a DB query after seeding).
  const openConvo = await createConversation(scope, {
    contactId: alex.id,
    channel: 'CHAT',
    subject: 'Cannot log in on mobile',
  });
  await exchange(openConvo.id, [
    { from: 'CUSTOMER', text: 'Hi, I cannot log in from the mobile app since this morning.' },
    { from: 'AGENT', text: 'Sorry about that — which device and OS version are you on?' },
    { from: 'CUSTOMER', text: 'iPhone 15, iOS 18.1. It just spins after I tap sign in.' },
    { from: 'AGENT', text: 'Thanks. Could you try removing and reinstalling the app?' },
    { from: 'CUSTOMER', text: 'Just did — same spinner.' },
    { from: 'AGENT', text: 'Understood. Can you confirm the email you sign in with?' },
    { from: 'CUSTOMER', text: 'alex@customer.test' },
    { from: 'AGENT', text: 'Found the account. Resetting your session now, try again in a minute.' },
    { from: 'CUSTOMER', text: 'That worked, thank you!' },
  ]);

  // 2. Assigned to the agent, SNOOZED with a future wake time.
  const snoozedConvo = await createConversation(scope, {
    contactId: bailey.id,
    channel: 'CHAT',
    subject: 'Question about annual billing',
  });
  await exchange(snoozedConvo.id, [
    { from: 'CUSTOMER', text: 'Do you offer a discount for paying annually?' },
    { from: 'AGENT', text: 'Let me check with billing and get back to you.' },
  ]);
  await patchConversation(scope, snoozedConvo.id, { assigneeId: agent.id }, adminId);
  await patchConversation(
    scope,
    snoozedConvo.id,
    { status: 'SNOOZED', snoozedUntil: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
    adminId,
  );

  // 3. RESOLVED, then a further customer message — demonstrates the reopen rule
  // directly in the seeded data: this conversation ends up OPEN again.
  const reopenedConvo = await createConversation(scope, {
    contactId: alex.id,
    channel: 'CHAT',
    subject: 'Refund status',
  });
  await exchange(reopenedConvo.id, [
    { from: 'CUSTOMER', text: 'Has my refund been processed yet?' },
    { from: 'AGENT', text: 'Yes, processed yesterday — 5-10 business days to appear.' },
  ]);
  await patchConversation(scope, reopenedConvo.id, { status: 'RESOLVED' }, adminId);
  await exchange(reopenedConvo.id, [
    { from: 'CUSTOMER', text: 'It still has not shown up after 10 days.' },
  ]);

  // 4. EMAIL channel, OPEN, unassigned — exercises the channel filter. Full
  // threading metadata (email_threads/email_messages) arrives with Phase E; this
  // is just the base conversation/message rows Phase C already supports.
  const emailConvo = await createConversation(scope, {
    contactId: casey.id,
    channel: 'EMAIL',
    subject: 'Invoice question',
  });
  await exchange(emailConvo.id, [
    { from: 'CUSTOMER', text: 'Could you resend the invoice for last month?' },
  ]);

  console.log('Seed complete:');
  console.log(`  ${openConvo.id}      OPEN      unassigned  CHAT   (9 messages)`);
  console.log(`  ${snoozedConvo.id}      SNOOZED   -> agent    CHAT   (2 messages)`);
  console.log(`  ${reopenedConvo.id}      OPEN*     unassigned  CHAT   (3 messages, *reopened after resolve)`);
  console.log(`  ${emailConvo.id}      OPEN      unassigned  EMAIL  (1 message)`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
