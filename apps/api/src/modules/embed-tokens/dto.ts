import type { EmbedTokenDto } from '@gigachad/shared';

export interface EmbedTokenRow {
  id: string;
  workspaceId: string;
  token: string;
  label: string;
  allowedOrigin: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function embedTokenDto(row: EmbedTokenRow): EmbedTokenDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    token: row.token,
    label: row.label,
    allowedOrigin: row.allowedOrigin,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
