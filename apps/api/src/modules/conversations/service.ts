import type {
  ConversationDto,
  ConversationListQuery,
  CreateConversationInput,
  Page,
  PatchConversationInput,
  ReadInput,
} from '@gigachad/shared';
import { z } from 'zod';

import { db } from '../../db';
import { AppError, notFound } from '../../lib/errors';
import { decodeCursor, requireFound, takeWithLookahead, toPage, type WorkspaceScope } from '../../lib/repo';
import { conversationDto } from './dto';
import * as repo from './repo';

const conversationCursor = z.object({ v: z.literal(1), lastMessageAt: z.string(), id: z.string() });

export async function listConversations(
  scope: WorkspaceScope,
  query: ConversationListQuery,
): Promise<Page<ConversationDto>> {
  const before = query.cursor
    ? (() => {
        const c = decodeCursor(query.cursor, conversationCursor);
        return { lastMessageAt: new Date(c.lastMessageAt), id: c.id };
      })()
    : undefined;

  const rows = await repo.listConversations(
    scope,
    { channel: query.channel, status: query.status, assigneeId: query.assigneeId },
    { take: takeWithLookahead(query.limit), before },
  );

  return toPage(rows, query.limit, conversationDto, (row) => ({
    lastMessageAt: row.lastMessageAt.toISOString(),
    id: row.id,
  }));
}

export async function getConversation(
  scope: WorkspaceScope,
  conversationId: string,
): Promise<ConversationDto> {
  return conversationDto(requireFound(await repo.findConversation(scope, conversationId), 'conversation'));
}

/**
 * Creates a conversation.
 *
 * Per docs/05-api.md this route exists for members too, but "normally" a
 * conversation is created by channel ingestion (a widget session in Phase D, an
 * inbound email in Phase E) rather than from this dashboard — there is no "new
 * conversation" screen. It is exercised directly here by the seed script.
 */
export async function createConversation(
  scope: WorkspaceScope,
  input: CreateConversationInput,
): Promise<ConversationDto> {
  requireFound(await repo.findContactForConversation(scope, input.contactId), 'contact');

  const created = await repo.createConversation({
    workspaceId: scope.workspaceId,
    contactId: input.contactId,
    channel: input.channel,
    subject: input.subject,
  });

  return conversationDto(created);
}

/**
 * Validates the requested change against the conversation's CURRENT state.
 *
 * `snoozedUntil` is only ever meaningful paired with an explicit `status: SNOOZED`
 * in the same request — a snooze action always specifies its own duration, and
 * every other transition (assign, resolve, reopen) leaves snoozedUntil alone; the
 * server clears it automatically when the resulting status is not SNOOZED. This
 * is a state-machine rule rather than a shape rule, which is why it is
 * `INVALID_TRANSITION` (docs/16-errors-and-limits.md) and not `VALIDATION_FAILED`.
 */
function assertValidTransition(input: PatchConversationInput): void {
  if (input.status === 'SNOOZED') {
    const until = input.snoozedUntil ? new Date(input.snoozedUntil).getTime() : NaN;
    if (!(until > Date.now())) {
      throw new AppError('INVALID_TRANSITION', {
        message: 'Choose a time in the future to snooze until.',
        fieldErrors: { snoozedUntil: 'Choose a time in the future.' },
      });
    }
  } else if (input.snoozedUntil !== undefined && input.snoozedUntil !== null) {
    throw new AppError('INVALID_TRANSITION', {
      message: 'snoozedUntil is only valid together with status: SNOOZED.',
    });
  }
}

export async function patchConversation(
  scope: WorkspaceScope,
  conversationId: string,
  input: PatchConversationInput,
  actingUserId: string,
): Promise<ConversationDto> {
  assertValidTransition(input);

  const updated = await db.$transaction(async (tx) => {
    const current = requireFound(
      await repo.findConversationState(tx, scope, conversationId),
      'conversation',
    );

    if (input.assigneeId !== undefined && input.assigneeId !== null) {
      // An assignee id that does not resolve to an active member of this
      // workspace is treated exactly like any other foreign or nonexistent
      // resource: 404, not a validation error naming who is missing
      // (docs/04-database.md tenant isolation rules).
      if (!(await repo.isActiveMember(tx, scope, input.assigneeId))) {
        throw notFound('member');
      }
    }

    const data: { status?: typeof current.status; assigneeId?: string | null; snoozedUntil?: Date | null } = {};
    if (input.status !== undefined) {
      data.status = input.status;
      data.snoozedUntil = input.status === 'SNOOZED' ? new Date(input.snoozedUntil!) : null;
    }
    if (input.assigneeId !== undefined) {
      data.assigneeId = input.assigneeId;
    }

    if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
      await repo.endCurrentAssignment(tx, scope, conversationId);
      if (input.assigneeId !== null) {
        await repo.insertAssignment(tx, scope, {
          conversationId,
          assigneeId: input.assigneeId,
          assignedBy: actingUserId,
        });
      }
    }

    return repo.updateConversationFields(tx, scope, conversationId, data);
  });

  return conversationDto(updated);
}

export async function markConversationRead(
  scope: WorkspaceScope,
  conversationId: string,
  input: ReadInput,
): Promise<{ lastReadSequence: number }> {
  const row = await repo.updateAgentReadSequence(scope, conversationId, input.lastReadSequence);
  if (!row) throw notFound('conversation');
  return { lastReadSequence: row.agentLastReadSequence };
}
