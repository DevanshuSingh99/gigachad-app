import type { CannedResponseDto } from '@gigachad/shared';

export interface CannedResponseRow {
  id: string;
  workspaceId: string;
  name: string;
  content: string;
  shortcut: string | null;
  tags: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function cannedResponseDto(row: CannedResponseRow): CannedResponseDto {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    shortcut: row.shortcut,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
