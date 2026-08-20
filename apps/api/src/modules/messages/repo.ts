import type { SenderType } from '@gigachad/shared';

import { db, type Tx } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderType: true,
  senderUserId: true,
  senderUser: { select: { name: true } },
  bodyText: true,
  bodyHtml: true,
  clientMessageId: true,
  sequence: true,
  deliveryStatus: true,
  createdAt: true,
} as const;

export function listMessages(
  scope: WorkspaceScope,
  conversationId: string,
  opts: { take: number; afterSequence?: number },
) {
  return db.message.findMany({
    where: {
      workspaceId: scope.workspaceId,
      conversationId,
      ...(opts.afterSequence !== undefined ? { sequence: { gt: opts.afterSequence } } : {}),
    },
    select: MESSAGE_SELECT,
    orderBy: { sequence: 'asc' },
    take: opts.take,
  });
}

/** The idempotency pre-check: a scoped lookup by the client's own retry key. */
export function findByClientMessageId(
  client: Tx,
  scope: WorkspaceScope,
  conversationId: string,
  clientMessageId: string,
) {
  return client.message.findFirst({
    where: { workspaceId: scope.workspaceId, conversationId, clientMessageId },
    select: MESSAGE_SELECT,
  });
}

export function insertMessage(
  client: Tx,
  data: {
    workspaceId: string;
    conversationId: string;
    senderType: SenderType;
    senderUserId?: string;
    bodyText: string;
    bodyHtml?: string;
    clientMessageId: string;
    sequence: number;
  },
) {
  return client.message.create({ data, select: MESSAGE_SELECT });
}
