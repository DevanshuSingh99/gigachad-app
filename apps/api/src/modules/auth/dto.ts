import type { MeDto, MembershipDto, UserDto, WorkspaceRole } from '@gigachad/shared';

/**
 * Response serialization.
 *
 * Express does not serialize by schema, so these functions are the only thing
 * standing between an internal column and a customer's browser (invariant 6).
 * Note what they do NOT do: spread a row. Every field is named, so adding a column
 * to the schema — `password_hash` being the obvious one — cannot start appearing
 * in a response by accident.
 */

export interface UserRow {
  id: string;
  email: string;
  name: string;
}

export function userDto(row: UserRow): UserDto {
  return { id: row.id, email: row.email, name: row.name };
}

export interface MembershipRow {
  role: WorkspaceRole;
  workspaceId: string;
  workspace: { name: string; slug: string; supportAddress: string };
}

export function membershipDto(row: MembershipRow): MembershipDto {
  return {
    workspaceId: row.workspaceId,
    workspaceName: row.workspace.name,
    workspaceSlug: row.workspace.slug,
    supportAddress: row.workspace.supportAddress,
    role: row.role,
  };
}

export function meDto(user: UserRow, memberships: MembershipRow[]): MeDto {
  return { user: userDto(user), memberships: memberships.map(membershipDto) };
}
