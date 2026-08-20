import type { PatchWorkspaceInput, WorkspaceDto } from '@gigachad/shared';
import { workspaceSettings, defaultWorkspaceSettings } from '@gigachad/shared';

import { db, type Tx } from '../../db';
import { env, supportAddressFor } from '../../env';
import { AppError } from '../../lib/errors';
import { newWidgetKey } from '../../lib/ids';
import { requireFound, type WorkspaceScope } from '../../lib/repo';
import { slugCandidates } from '../../lib/slug';
import { workspaceDto, parseSettings } from './dto';
import * as repo from './repo';

/**
 * Picks the first available slug for a workspace name.
 *
 * Checked before the transaction so a taken slug costs a cheap read rather than an
 * aborted transaction. The check is still racy by nature — two signups for
 * "Acme" can both see the same slug free — so the caller retries on the unique
 * violation. The database is the arbiter; this just avoids losing that race
 * most of the time.
 */
export async function resolveAvailableSlug(name: string): Promise<string> {
  const candidates = slugCandidates(name);
  for (const candidate of candidates) {
    if (!(await repo.isSlugTaken(candidate))) return candidate;
  }
  // Every candidate including the random ones was taken, which in practice means
  // something is wrong rather than unlucky.
  throw new AppError('SLUG_TAKEN', {
    message: 'Could not derive an available workspace address. Try a different name.',
    fieldErrors: { workspaceName: 'That name is not available.' },
  });
}

/**
 * Creates a workspace and makes one user its Admin.
 *
 * Shared by signup and by creating an additional workspace, so both paths produce
 * identical records — including the derived support address and the public widget
 * key. Runs inside a caller-supplied transaction: a workspace with no Admin would
 * be unrecoverable through the API, since every membership route requires one.
 */
export async function createWorkspaceWithAdmin(
  client: Tx,
  input: { userId: string; name: string; slug: string },
): Promise<WorkspaceDto> {
  const workspace = await repo.insertWorkspace(client, {
    name: input.name,
    slug: input.slug,
    widgetKey: newWidgetKey(),
    // Stored rather than derived on read, so it survives a platform domain change.
    supportAddress: supportAddressFor(input.slug),
    settingsJson: defaultWorkspaceSettings(env.AI_SUMMARY_MIN_MESSAGES),
  });

  await repo.insertMembership(client, {
    workspaceId: workspace.id,
    userId: input.userId,
    role: 'ADMIN',
  });

  return workspaceDto(workspace);
}

export async function createWorkspaceForUser(userId: string, name: string): Promise<WorkspaceDto> {
  const slug = await resolveAvailableSlug(name);
  return db.$transaction((tx) => createWorkspaceWithAdmin(tx, { userId, name, slug }));
}

export async function getWorkspace(scope: WorkspaceScope): Promise<WorkspaceDto> {
  return workspaceDto(requireFound(await repo.findWorkspace(scope), 'workspace'));
}

export async function patchWorkspace(
  scope: WorkspaceScope,
  input: PatchWorkspaceInput,
): Promise<WorkspaceDto> {
  const existing = requireFound(await repo.findWorkspace(scope), 'workspace');

  const data: { name?: string; settingsJson?: unknown } = {};
  if (input.name !== undefined) data.name = input.name;

  if (input.settings !== undefined) {
    // Merge over what is stored, then validate the whole result: a partial write
    // must not be able to leave the column in a shape the full schema rejects.
    const merged = { ...parseSettings(existing.settingsJson), ...input.settings };
    const validated = workspaceSettings.safeParse(merged);
    if (!validated.success) {
      throw new AppError('VALIDATION_FAILED', {
        fieldErrors: Object.fromEntries(
          validated.error.issues.map((i) => [`settings.${i.path.join('.')}`, i.message]),
        ),
      });
    }
    data.settingsJson = validated.data;
  }

  if (data.name === undefined && data.settingsJson === undefined) {
    return workspaceDto(existing);
  }

  return workspaceDto(await repo.updateWorkspace(scope, data));
}
