import type {
  AcceptInvitationInput,
  CreatedInvitationDto,
  CreateInvitationInput,
  InvitationDto,
  InvitationPreviewDto,
  MeDto,
} from '@gigachad/shared';
import { LIFETIMES } from '@gigachad/shared';

import { db, type Tx } from '../../db';
import { env } from '../../env';
import { AppError } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { requireFound, type WorkspaceScope } from '../../lib/repo';
import { createSession, type CreatedSession } from '../../lib/sessions';
import { generateOpaqueToken, hashToken } from '../../lib/tokens';
import { meDto } from '../auth/dto';
import * as authRepo from '../auth/repo';
import * as memberRepo from '../members/repo';
import { createdInvitationDto, invitationDto, invitationPreviewDto } from './dto';
import * as repo from './repo';

/**
 * The accept link. A query parameter rather than a path segment because the
 * dashboard is a static export, which cannot serve an arbitrary dynamic path
 * without a server to route it.
 */
function inviteUrl(token: string): string {
  return `${env.DASHBOARD_ORIGIN}/invite?token=${encodeURIComponent(token)}`;
}

export async function listInvitations(scope: WorkspaceScope): Promise<InvitationDto[]> {
  return (await repo.listPending(scope)).map(invitationDto);
}

/**
 * Creates an invitation.
 *
 * One pending invitation per email per workspace: inviting the same person again
 * replaces the previous token rather than accumulating live links. That keeps the
 * newest link the only working one, and means an Admin who lost the first link has
 * a way to get a usable one.
 */
export async function createInvitation(
  scope: WorkspaceScope,
  invitedBy: string,
  input: CreateInvitationInput,
): Promise<CreatedInvitationDto> {
  // "Existing members cannot be duplicated" (docs/02-product-flows.md). Checked by
  // resolving the address to a user first, because membership is keyed by user id
  // rather than by email.
  const invitedUser = await authRepo.findUserByEmail(input.email);
  if (invitedUser) {
    const membership = await memberRepo.findMembershipForUser(db, scope, invitedUser.id);
    if (membership?.status === 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', {
        fieldErrors: { email: 'That person is already a member of this workspace.' },
      });
    }
  }

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + LIFETIMES.invitationDays * 24 * 60 * 60 * 1000);

  const superseded = await repo.findPendingForEmail(scope, input.email);
  const row = superseded
    ? await repo.replaceInvitation(scope, superseded.id, {
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedBy,
      })
    : await repo.createInvitation({
        workspaceId: scope.workspaceId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedBy,
      });

  return createdInvitationDto(row, inviteUrl(token));
}

/** Anything unusable — consumed, expired, or unknown — is one indistinguishable 410. */
function assertUsable(invitation: { acceptedAt: Date | null; expiresAt: Date } | null) {
  if (!invitation) throw new AppError('INVITATION_INVALID');
  if (invitation.acceptedAt) {
    throw new AppError('INVITATION_INVALID', { message: 'This invitation has already been used.' });
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new AppError('INVITATION_INVALID', { message: 'This invitation has expired.' });
  }
}

export async function previewInvitation(token: string): Promise<InvitationPreviewDto> {
  const invitation = await repo.findByTokenHash(db, hashToken(token));
  assertUsable(invitation);
  return invitationPreviewDto(invitation!, invitation!.workspace.name);
}

export interface AcceptResult {
  me: MeDto;
  /** Absent when the caller was already signed in as the invited user. */
  session?: CreatedSession;
}

/**
 * Accepts an invitation.
 *
 * Three entry paths, one outcome:
 *   * already signed in — the session's email must equal the invited address;
 *   * the invited address already has an account — the password authenticates it;
 *   * no account yet — name and password create one.
 *
 * The email always comes from the invitation record, never from the request body.
 * A client that could supply its own email could accept someone else's invitation,
 * which is the failure mode docs/18-execution.md calls out for this phase.
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
  currentUser: { id: string; email: string; name: string } | null,
): Promise<AcceptResult> {
  const preloaded = await repo.findByTokenHash(db, hashToken(token));
  assertUsable(preloaded);
  const invitation = preloaded!;

  // Resolve who is accepting, and authenticate them, before opening a
  // transaction: password hashing and verification are slow and must not hold a
  // row lock.
  let userId: string;
  let user: { id: string; email: string; name: string };
  let needsSession: boolean;
  let passwordHashForNewUser: string | null = null;

  if (currentUser) {
    if (currentUser.email !== invitation.email) {
      throw new AppError('INVITATION_INVALID', {
        message: `This invitation was sent to ${invitation.email}. Sign in as that account to accept it.`,
        detail: { reason: 'email mismatch' },
      });
    }
    userId = currentUser.id;
    user = currentUser;
    needsSession = false;
  } else {
    const existing = await authRepo.findUserByEmailForLogin(invitation.email);
    if (existing) {
      if (!input.password) {
        throw new AppError('VALIDATION_FAILED', {
          fieldErrors: { password: 'Enter your password to accept this invitation.' },
        });
      }
      if (!(await verifyPassword(existing.passwordHash, input.password))) {
        throw new AppError('INVALID_CREDENTIALS');
      }
      userId = existing.id;
      user = { id: existing.id, email: existing.email, name: existing.name };
      needsSession = true;
    } else {
      if (!input.password || !input.name) {
        throw new AppError('VALIDATION_FAILED', {
          fieldErrors: {
            ...(input.name ? {} : { name: 'Enter your name.' }),
            ...(input.password ? {} : { password: 'Choose a password.' }),
          },
        });
      }
      passwordHashForNewUser = await hashPassword(input.password);
      userId = '';
      user = { id: '', email: invitation.email, name: input.name };
      needsSession = true;
    }
  }

  const scope: WorkspaceScope = { workspaceId: invitation.workspaceId };

  const result = await db.$transaction(async (tx: Tx) => {
    // Same lock every membership mutation takes, so accepting cannot race a
    // concurrent removal or role change.
    await memberRepo.lockWorkspaceForMembershipChange(tx, scope.workspaceId);

    // Re-read under the lock: the token may have been consumed between the
    // preflight read and here.
    const fresh = await repo.findByTokenHash(tx, hashToken(token));
    assertUsable(fresh);

    if (passwordHashForNewUser) {
      const created = await authRepo.createUser(tx, {
        email: invitation.email,
        passwordHash: passwordHashForNewUser,
        name: user.name,
      });
      userId = created.id;
      user = created;
    }

    // Idempotent membership: an existing row is reactivated and re-roled rather
    // than duplicated, which is also what makes re-inviting a removed member work.
    const membership = await memberRepo.findMembershipForUser(tx, scope, userId);
    if (membership) {
      await tx.workspaceMember.update({
        where: { id: membership.id, workspaceId: scope.workspaceId },
        data: { role: invitation.role, status: 'ACTIVE' },
        select: { id: true },
      });
    } else {
      await tx.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId, role: invitation.role },
        select: { id: true },
      });
    }

    // Single use: consumed inside the same transaction as the membership.
    await repo.markAccepted(tx, scope, invitation.id);

    const session = needsSession ? await createSession(tx, userId) : undefined;
    return { session };
  });

  const memberships = await authRepo.listMembershipsForUser(userId);
  return {
    me: meDto(user, memberships),
    ...(result.session ? { session: result.session } : {}),
  };
}
