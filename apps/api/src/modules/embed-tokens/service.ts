import type { CreateEmbedTokenInput, EmbedTokenDto } from '@gigachad/shared';

import { newEmbedToken } from '../../lib/ids';
import { requireFound, type WorkspaceScope } from '../../lib/repo';
import { embedTokenDto } from './dto';
import * as repo from './repo';

export async function listEmbedTokens(scope: WorkspaceScope): Promise<EmbedTokenDto[]> {
  return (await repo.listEmbedTokens(scope)).map(embedTokenDto);
}

export async function createEmbedToken(
  scope: WorkspaceScope,
  input: CreateEmbedTokenInput,
): Promise<EmbedTokenDto> {
  const row = await repo.createEmbedToken(scope, {
    token: newEmbedToken(),
    label: input.label,
    allowedOrigin: input.allowedOrigin,
  });
  return embedTokenDto(row);
}

export async function revokeEmbedToken(
  scope: WorkspaceScope,
  tokenId: string,
): Promise<EmbedTokenDto> {
  requireFound(await repo.findEmbedToken(scope, tokenId), 'embed token');
  return embedTokenDto(await repo.revokeEmbedToken(scope, tokenId));
}
