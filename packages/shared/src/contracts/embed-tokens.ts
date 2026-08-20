import { z } from 'zod';

/**
 * Embed token contracts — shared between the API and the dashboard client.
 *
 * An embed token is a per-domain widget key (`wk_embed_…`) that restricts the
 * chat widget to exactly one allowed origin. Admins create them in the dashboard
 * and paste the generated script snippet into their site.
 */

const HTTPS_ORIGIN_RE = /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?(:\d+)?$/;

export const createEmbedTokenInput = z.object({
  label: z.string().trim().min(1, 'Label is required.').max(80, 'Label must be 80 characters or fewer.'),
  /** Full https origin, e.g. https://chat.example.com — no trailing slash. */
  allowedOrigin: z
    .string()
    .trim()
    .regex(HTTPS_ORIGIN_RE, 'Enter a valid https origin, e.g. https://chat.example.com'),
});
export type CreateEmbedTokenInput = z.infer<typeof createEmbedTokenInput>;

export interface EmbedTokenDto {
  id: string;
  workspaceId: string;
  token: string;
  label: string;
  allowedOrigin: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
