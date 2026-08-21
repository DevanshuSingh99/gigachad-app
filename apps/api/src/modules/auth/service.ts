import type { LoginInput, MeDto, SignupInput } from '@gigachad/shared';

import { db } from '../../db';
import { supportAddressFor } from '../../env';
import { AppError } from '../../lib/errors';
import { burnPasswordVerification, hashPassword, verifyPassword } from '../../lib/password';
import { isUniqueViolationOn } from '../../lib/prismaErrors';
import { createSession, revokeSession, type CreatedSession } from '../../lib/sessions';
import { createWorkspaceWithAdmin, resolveAvailableSlug } from '../workspaces/service';
import { meDto } from './dto';
import * as repo from './repo';

export interface AuthResult {
  me: MeDto;
  session: CreatedSession;
}

/**
 * Signup: one transaction producing a user, a workspace, an ADMIN membership, and
 * a session.
 *
 * All four or none. A user with no workspace has nowhere to land, and a workspace
 * with no Admin cannot be administered at all — every membership route requires
 * one — so neither half is a state worth being able to reach.
 *
 * The password hash and the slug lookup happen outside the transaction on purpose:
 * Argon2 takes tens of milliseconds and holding a database transaction open across
 * it wastes a connection from a pool of eight.
 */
export async function signup(input: SignupInput): Promise<AuthResult> {
  // Signup does tell the caller an email is already registered. That is account
  // enumeration, accepted knowingly: the alternative is a signup form that fails
  // with no explanation, and the mitigation (mail the existing account instead)
  // needs the email channel that does not exist yet. Login stays generic, which is
  // where enumeration actually pays off for an attacker.
  if (await repo.findUserByEmail(input.email)) {
    throw new AppError('VALIDATION_FAILED', {
      fieldErrors: { email: 'That email already has an account. Sign in instead.' },
    });
  }

  const passwordHash = await hashPassword(input.password);

  // The slug pre-check is racy by nature, so a lost race is retried rather than
  // surfaced: two people naming a workspace "Acme" at once is ordinary.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await resolveAvailableSlug(input.workspaceName);
    try {
      return await db.$transaction(async (tx) => {
        const user = await repo.createUser(tx, {
          email: input.email,
          passwordHash,
          name: input.name,
        });
        const workspace = await createWorkspaceWithAdmin(tx, {
          userId: user.id,
          name: input.workspaceName,
          slug,
        });
        const session = await createSession(tx, user.id);

        return {
          me: meDto(user, [
            {
              role: 'ADMIN',
              workspaceId: workspace.id,
              workspace: {
                name: workspace.name,
                slug: workspace.slug,
                supportAddress: supportAddressFor(workspace.slug),
              },
            },
          ]),
          session,
        };
      });
    } catch (error) {
      if (isUniqueViolationOn(error, 'email')) {
        throw new AppError('VALIDATION_FAILED', {
          fieldErrors: { email: 'That email already has an account. Sign in instead.' },
        });
      }
      if (isUniqueViolationOn(error, 'slug') && attempt < 2) continue;
      throw error;
    }
  }

  throw new AppError('SLUG_TAKEN', {
    fieldErrors: { workspaceName: 'That name is not available. Try another.' },
  });
}

/**
 * Login.
 *
 * An unknown email and a wrong password return the identical error, and both cost
 * one Argon2 verification — returning early for an unknown email would leak
 * account existence through response time and undo the point of the shared
 * message.
 */
export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await repo.findUserByEmailForLogin(input.email);

  if (!user) {
    await burnPasswordVerification(input.password);
    throw new AppError('INVALID_CREDENTIALS');
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError('INVALID_CREDENTIALS');
  }

  const session = await createSession(db, user.id);
  const memberships = await repo.listMembershipsForUser(user.id);

  return {
    me: meDto({ id: user.id, email: user.email, name: user.name }, memberships),
    session,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

export async function me(user: { id: string; email: string; name: string }): Promise<MeDto> {
  return meDto(user, await repo.listMembershipsForUser(user.id));
}
