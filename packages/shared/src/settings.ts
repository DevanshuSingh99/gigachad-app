import { z } from 'zod';

import { AI } from './limits';

/**
 * `workspaces.settings_json` has a fixed, validated shape — it is a settings
 * column, not a dumping ground (docs/04-database.md). PATCH /workspaces/:id
 * validates against exactly this.
 */

/** A browser origin: scheme, host, optional port. No path, no trailing slash. */
export const origin = z
  .string()
  .trim()
  .min(7)
  .max(255)
  .refine((v) => {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // `new URL('https://a.com/x')` keeps the path, so compare against the
    // canonical origin to reject anything more than scheme://host[:port].
    return url.origin === v.replace(/\/$/, '');
  }, 'Enter an origin such as https://example.com — no path.')
  .transform((v) => v.replace(/\/$/, ''));

/** Snooze durations offered in the menu, e.g. `3h`, `1d`, `1w`. */
export const snoozePreset = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^\d{1,3}[hdw]$/, 'Use a duration such as 3h, 1d, or 1w.');

export const DEFAULT_SNOOZE_PRESETS = ['3h', '1d', '3d', '1w'] as const;

export const workspaceSettings = z.object({
  /**
   * Origins permitted to create a widget session and embed the panel. Per
   * workspace rather than global config, because each tenant installs on its
   * own site (docs/00-index.md decision log).
   */
  allowedWidgetOrigins: z.array(origin).max(20).default([]),
  aiSummaryMinMessages: z.number().int().min(2).max(50).default(AI.minMessages),
  snoozePresets: z.array(snoozePreset).min(1).max(8).default([...DEFAULT_SNOOZE_PRESETS]),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettings>;

export function defaultWorkspaceSettings(aiSummaryMinMessages: number): WorkspaceSettings {
  return {
    allowedWidgetOrigins: [],
    aiSummaryMinMessages,
    snoozePresets: [...DEFAULT_SNOOZE_PRESETS],
  };
}

/**
 * Partial form for PATCH. The server merges this over the stored settings and
 * validates the result against `workspaceSettings`, so every write still has to
 * satisfy the full shape.
 */
export const workspaceSettingsPatch = workspaceSettings.partial();
export type WorkspaceSettingsPatch = z.infer<typeof workspaceSettingsPatch>;
