import type { WorkspaceDto, WorkspaceSettings } from '@gigachad/shared';
import { workspaceSettings } from '@gigachad/shared';

/** Every field named explicitly. Never a spread of a database row (invariant 6). */
export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  widgetKey: string;
  supportAddress: string;
  settingsJson: unknown;
  createdAt: Date;
}

/**
 * Settings are validated on the way out as well as in.
 *
 * The column is JSON, so nothing at the database level stops a hand-edited or
 * legacy row from holding a shape the application no longer expects. Parsing here
 * means a malformed row degrades to defaults instead of shipping something the
 * dashboard cannot render.
 */
export function parseSettings(value: unknown): WorkspaceSettings {
  const parsed = workspaceSettings.safeParse(value ?? {});
  return parsed.success ? parsed.data : workspaceSettings.parse({});
}

export function workspaceDto(row: WorkspaceRow): WorkspaceDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    widgetKey: row.widgetKey,
    supportAddress: row.supportAddress,
    settings: parseSettings(row.settingsJson),
    createdAt: row.createdAt.toISOString(),
  };
}
