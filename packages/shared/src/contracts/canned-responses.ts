import { z } from 'zod';

import { uuid } from '../primitives';
import { CAPS } from '../limits';

/**
 * Canned-response contracts (S2 stretch feature).
 * Single source of truth for the dashboard client and the API boundary validation.
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * Optional keyboard shortcut. Lowercase letters, digits, and hyphens only.
 * An agent types /shortcut in the composer to trigger insertion.
 */
const shortcutField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(CAPS.cannedResponseShortcutChars)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.');

const tagsField = z.array(z.string().trim().min(1).max(50)).max(10).default([]);

// ─── Create ───────────────────────────────────────────────────────────────────

export const createCannedResponseInput = z.object({
  name: z.string().trim().min(1).max(CAPS.cannedResponseNameChars),
  content: z.string().trim().min(1).max(CAPS.cannedResponseContentChars),
  shortcut: shortcutField.optional(),
  tags: tagsField,
});
export type CreateCannedResponseInput = z.infer<typeof createCannedResponseInput>;

// ─── Patch ────────────────────────────────────────────────────────────────────

export const patchCannedResponseInput = z
  .object({
    name: z.string().trim().min(1).max(CAPS.cannedResponseNameChars).optional(),
    content: z.string().trim().min(1).max(CAPS.cannedResponseContentChars).optional(),
    shortcut: shortcutField.nullable().optional(),
    tags: tagsField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type PatchCannedResponseInput = z.infer<typeof patchCannedResponseInput>;

// ─── Query ────────────────────────────────────────────────────────────────────

export const cannedResponseListQuery = z.object({
  search: z.string().trim().min(1).max(CAPS.searchQueryChars).optional(),
  tag: z.string().trim().min(1).max(50).optional(),
});
export type CannedResponseListQuery = z.infer<typeof cannedResponseListQuery>;

// ─── DTO ──────────────────────────────────────────────────────────────────────

export interface CannedResponseDto {
  id: string;
  name: string;
  content: string;
  shortcut: string | null;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Params ───────────────────────────────────────────────────────────────────

export const cannedResponseParams = z.object({
  workspaceId: uuid,
  responseId: uuid,
});
