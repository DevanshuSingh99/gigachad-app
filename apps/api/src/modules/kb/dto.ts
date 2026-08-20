import type {
  ArticleDto,
  ArticleSummaryDto,
  CategoryDto,
  ArticleStatus,
  SuggestionDto,
} from '@gigachad/shared';

// ─── Category ──────────────────────────────────────────────────────────────────

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count: { articles: number };
}

export function categoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sortOrder,
    articleCount: row._count.articles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Article ───────────────────────────────────────────────────────────────────

export interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  status: ArticleStatus;
  categoryId: string | null;
  category: { name: string } | null;
  authorId: string | null;
  author: { name: string } | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bodyHtml?: string;
  bodyText?: string;
}

export function articleSummaryDto(row: ArticleRow): ArticleSummaryDto {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function articleDto(row: ArticleRow & { bodyHtml: string; bodyText: string }): ArticleDto {
  return {
    ...articleSummaryDto(row),
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
  };
}

// ─── Suggestion ────────────────────────────────────────────────────────────────

export interface SuggestionRow {
  id: string;
  title: string;
  slug: string;
}

export function suggestionDto(row: SuggestionRow): SuggestionDto {
  return { id: row.id, title: row.title, slug: row.slug };
}
