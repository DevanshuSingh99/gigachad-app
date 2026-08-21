import type {
  CannedResponseDto,
  CannedResponseListQuery,
  CreateCannedResponseInput,
  PatchCannedResponseInput,
} from '@gigachad/shared';

import { AppError } from '../../lib/errors';
import { requireFound } from '../../lib/repo';
import type { WorkspaceScope } from '../../lib/repo';
import { cannedResponseDto } from './dto';
import * as repo from './repo';

export async function listCannedResponses(
  scope: WorkspaceScope,
  query: CannedResponseListQuery,
): Promise<CannedResponseDto[]> {
  return (await repo.listCannedResponses(scope, query)).map(cannedResponseDto);
}

export async function getCannedResponse(
  scope: WorkspaceScope,
  id: string,
): Promise<CannedResponseDto> {
  return cannedResponseDto(requireFound(await repo.findCannedResponse(scope, id), 'canned_response'));
}

export async function createCannedResponse(
  scope: WorkspaceScope,
  input: CreateCannedResponseInput,
  userId: string,
): Promise<CannedResponseDto> {
  if (input.shortcut) {
    const existing = await repo.findCannedResponseByShortcut(scope, input.shortcut);
    if (existing) throw new AppError('SLUG_TAKEN');
  }
  return cannedResponseDto(
    await repo.createCannedResponse(scope, {
      name: input.name,
      content: input.content,
      shortcut: input.shortcut,
      tags: input.tags,
      createdBy: userId,
    }),
  );
}

export async function patchCannedResponse(
  scope: WorkspaceScope,
  id: string,
  input: PatchCannedResponseInput,
): Promise<CannedResponseDto> {
  requireFound(await repo.findCannedResponse(scope, id), 'canned_response');

  if (input.shortcut) {
    const existing = await repo.findCannedResponseByShortcut(scope, input.shortcut);
    if (existing && existing.id !== id) throw new AppError('SLUG_TAKEN');
  }

  return cannedResponseDto(await repo.updateCannedResponse(scope, id, input));
}

export async function deleteCannedResponse(scope: WorkspaceScope, id: string): Promise<void> {
  requireFound(await repo.findCannedResponse(scope, id), 'canned_response');
  await repo.deleteCannedResponse(scope, id);
}
