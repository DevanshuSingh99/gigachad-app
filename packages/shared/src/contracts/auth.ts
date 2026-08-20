import { z } from 'zod';

import { email, password, personName } from '../primitives';
import { workspaceRole } from '../enums';
import type { WorkspaceRole } from '../enums';
import { workspaceSettingsPatch } from '../settings';
import type { WorkspaceSettings } from '../settings';

/**
 * Auth and tenancy contracts. The API validates against these and the dashboard's
 * client is typed from them, so a contract change fails at build time rather than
 * at runtime — the reason packages/shared exists (docs/18-execution.md).
 */

export const workspaceName = z.string().trim().min(2).max(80);

export const signupInput = z.object({
  email,
  password,
  name: personName,
  workspaceName,
});
export type SignupInput = z.infer<typeof signupInput>;

export const loginInput = z.object({
  email,
  // Not the `password` primitive: a length rule on login would reject a valid old
  // password and, worse, tell the caller which inputs are worth trying.
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

export const createWorkspaceInput = z.object({ name: workspaceName });
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

/**
 * Settings are patched partially and validated as a merged whole on the server, so
 * a caller can change one key without resending the rest — and cannot use a
 * partial write to leave the column in a shape the full schema would reject.
 */
export const patchWorkspaceInput = z.object({
  name: workspaceName.optional(),
  settings: workspaceSettingsPatch.optional(),
});
export type PatchWorkspaceInput = z.infer<typeof patchWorkspaceInput>;

export const createInvitationInput = z.object({ email, role: workspaceRole });
export type CreateInvitationInput = z.infer<typeof createInvitationInput>;

/**
 * Accepting an invitation deliberately takes no email: the address comes from the
 * invitation record, never from the client. Name and password are required only
 * when the invited address has no user yet.
 */
export const acceptInvitationInput = z.object({
  name: personName.optional(),
  password: z.string().min(1).max(200).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInput>;

export const patchMemberInput = z.object({ role: workspaceRole });
export type PatchMemberInput = z.infer<typeof patchMemberInput>;

// ─── Response shapes ──────────────────────────────────────────────────────────
// Every one of these is produced by an explicit DTO function on the server.
// Express has no schema-based response serialization, so these types are the
// contract and the DTO functions are what enforce it (invariant 6).

export interface UserDto {
  id: string;
  email: string;
  name: string;
}

export interface MembershipDto {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
}

export interface MeDto {
  user: UserDto;
  memberships: MembershipDto[];
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  widgetKey: string;
  supportAddress: string;
  settings: WorkspaceSettings;
  createdAt: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/**
 * Returned only from the create call, and only once: it embeds the single-use
 * token. Invitation email delivery arrives with the email channel in Phase E, so
 * until then the dashboard shows this link for the Admin to pass on — which is
 * also the documented fallback if email slips (docs/12-implementation-plan.md).
 */
export interface CreatedInvitationDto extends InvitationDto {
  inviteUrl: string;
}

/** What the accept screen may show before anyone commits to accepting. */
export interface InvitationPreviewDto {
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
  expiresAt: string;
}
