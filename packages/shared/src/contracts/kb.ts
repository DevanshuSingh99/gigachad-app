import { z } from 'zod';

import type { ArticleStatus } from '../enums';
import { articleStatus } from '../enums';
import { pagination, searchQuery, slug, uuid } from '../primitives';
import { CAPS } from '../limits';

/**
 * Knowledge base contracts. Single source of truth for the dashboard client
 * and the API boundary validation.
 */

// ─── Slugs / primitives ────────────────────────────────────────────────────────

/** Article slug: same shape as workspace slug but reserved words differ. */
const articleSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.');

// ─── Categories ────────────────────────────────────────────────────────────────

export const createCategoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug,
  sortOrder: z.number().int().min(0).default(0),
});
export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

export const patchCategoryInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    slug: slug.optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type PatchCategoryInput = z.infer<typeof patchCategoryInput>;

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  articleCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Articles ──────────────────────────────────────────────────────────────────

export const createArticleInput = z.object({
  title: z.string().trim().min(1).max(200),
  slug: articleSlug,
  categoryId: uuid.nullable().optional(),
  /** Rich HTML body — sanitized server-side against the article allowlist. */
  bodyHtml: z.string().min(1).max(CAPS.articleHtmlBytes),
});
export type CreateArticleInput = z.infer<typeof createArticleInput>;

export const patchArticleInput = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: articleSlug.optional(),
    categoryId: uuid.nullable().optional(),
    bodyHtml: z.string().min(1).max(CAPS.articleHtmlBytes).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type PatchArticleInput = z.infer<typeof patchArticleInput>;

export const articleListQuery = pagination.extend({
  status: articleStatus.optional(),
  search: searchQuery.optional(),
  categoryId: uuid.optional(),
});
export type ArticleListQuery = z.infer<typeof articleListQuery>;

export interface ArticleSummaryDto {
  id: string;
  title: string;
  slug: string;
  status: ArticleStatus;
  categoryId: string | null;
  categoryName: string | null;
  authorId: string | null;
  authorName: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDto extends ArticleSummaryDto {
  bodyHtml: string;
  bodyText: string;
}

// ─── Suggestions ───────────────────────────────────────────────────────────────

export const suggestionsQuery = z.object({
  q: z.string().trim().min(1).max(100),
});
export type SuggestionsQuery = z.infer<typeof suggestionsQuery>;

export interface SuggestionDto {
  id: string;
  title: string;
  slug: string;
}
