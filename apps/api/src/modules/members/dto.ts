import type { MemberDto, WorkspaceRole } from '@gigachad/shared';

export interface MemberRow {
  id: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
  user: { name: string; email: string };
}

/**
 * Named fields only. The joined user row carries a password hash in the database;
 * the select never asks for it and this never spreads, so there are two
 * independent reasons it cannot reach a response (invariant 6).
 */
export function memberDto(row: MemberRow): MemberDto {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}
