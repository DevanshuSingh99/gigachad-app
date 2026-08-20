import type {
  CreatedInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  WorkspaceRole,
} from '@gigachad/shared';

export interface InvitationRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

/** Note what is absent: tokenHash. It never leaves the database. */
export function invitationDto(row: InvitationRow): InvitationDto {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The link is returned once, from the create call only, because it embeds the
 * single-use token — which exists in plaintext exactly long enough to hand to the
 * Admin. Listing invitations never reproduces it.
 */
export function createdInvitationDto(row: InvitationRow, inviteUrl: string): CreatedInvitationDto {
  return { ...invitationDto(row), inviteUrl };
}

export function invitationPreviewDto(
  row: { email: string; role: WorkspaceRole; expiresAt: Date },
  workspaceName: string,
): InvitationPreviewDto {
  return {
    email: row.email,
    role: row.role,
    workspaceName,
    expiresAt: row.expiresAt.toISOString(),
  };
}
