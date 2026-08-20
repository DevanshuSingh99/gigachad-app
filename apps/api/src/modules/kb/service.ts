import { z } from 'zod';
import type {
  ArticleDto,
  ArticleListQuery,
  ArticleSummaryDto,
  CategoryDto,
  CreateArticleInput,
  CreateCategoryInput,
  Page,
  PatchArticleInput,
  PatchCategoryInput,
  SuggestionDto,
} from '@gigachad/shared';

import { db } from '../../db';
import { AppError, notFound } from '../../lib/errors';
import { decodeCursor, requireFound, takeWithLookahead, toPage, type WorkspaceScope } from '../../lib/repo';
import { sanitizeArticleHtml, extractBodyText } from '../../lib/sanitize';
import { articleDto, articleSummaryDto, categoryDto, suggestionDto } from './dto';
import * as repo from './repo';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Checks article slug uniqueness, optionally excluding the article being edited. */
async function assertUniqueArticleSlug(
  scope: WorkspaceScope,
  slug: string,
  excludeId?: string,
): Promise<void> {
  const existing = await db.knowledgeArticle.findFirst({
    where: {
      workspaceId: scope.workspaceId,
      slug,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new AppError('SLUG_TAKEN');
}

// ─── Categories ────────────────────────────────────────────────────────────────

export async function listCategories(scope: WorkspaceScope): Promise<CategoryDto[]> {
  return (await repo.listCategories(scope)).map(categoryDto);
}

export async function getCategory(scope: WorkspaceScope, id: string): Promise<CategoryDto> {
  return categoryDto(requireFound(await repo.findCategory(scope, id), 'category'));
}

export async function createCategory(
  scope: WorkspaceScope,
  input: CreateCategoryInput,
): Promise<CategoryDto> {
  const existing = await repo.findCategoryBySlug(scope, input.slug);
  if (existing) throw new AppError('SLUG_TAKEN');
  return categoryDto(await repo.createCategory(scope, input));
}

export async function patchCategory(
  scope: WorkspaceScope,
  id: string,
  input: PatchCategoryInput,
): Promise<CategoryDto> {
  requireFound(await repo.findCategory(scope, id), 'category');
  if (input.slug) {
    const existing = await repo.findCategoryBySlug(scope, input.slug);
    if (existing && existing.id !== id) throw new AppError('SLUG_TAKEN');
  }
  return categoryDto(await repo.updateCategory(scope, id, input));
}

export async function deleteCategory(scope: WorkspaceScope, id: string): Promise<void> {
  requireFound(await repo.findCategory(scope, id), 'category');
  const count = await repo.countArticlesInCategory(scope, id);
  if (count > 0) {
    throw new AppError('CATEGORY_NOT_EMPTY', {
      message: `Move or delete the ${count} article(s) in this category first.`,
    });
  }
  await repo.deleteCategory(scope, id);
}

// ─── Articles ──────────────────────────────────────────────────────────────────

const articleCursor = z.object({
  v: z.literal(1),
  updatedAt: z.string(),
  id: z.string(),
});

export async function listArticles(
  scope: WorkspaceScope,
  query: ArticleListQuery,
): Promise<Page<ArticleSummaryDto>> {
  const afterCursor = query.cursor
    ? (() => {
        const c = decodeCursor(query.cursor, articleCursor);
        return { updatedAt: new Date(c.updatedAt), id: c.id };
      })()
    : undefined;

  const rows = await repo.listArticles(
    scope,
    {
      status: query.status,
      categoryId: query.categoryId,
      search: query.search,
    },
    { take: takeWithLookahead(query.limit), afterCursor },
  );

  return toPage(rows, query.limit, articleSummaryDto, (row) => ({
    updatedAt: row.updatedAt.toISOString(),
    id: row.id,
  }));
}

export async function getArticle(scope: WorkspaceScope, id: string): Promise<ArticleDto> {
  const row = requireFound(await repo.findArticle(scope, id), 'article');
  return articleDto(row as Parameters<typeof articleDto>[0]);
}

export async function createArticle(
  scope: WorkspaceScope,
  input: CreateArticleInput,
  authorId: string,
): Promise<ArticleDto> {
  await assertUniqueArticleSlug(scope, input.slug);

  const bodyHtml = sanitizeArticleHtml(input.bodyHtml);
  const bodyText = extractBodyText(bodyHtml);

  const row = await repo.createArticle(scope, {
    title: input.title,
    slug: input.slug,
    categoryId: input.categoryId ?? null,
    bodyHtml,
    bodyText,
    authorId,
  });
  return articleDto(row as Parameters<typeof articleDto>[0]);
}

export async function patchArticle(
  scope: WorkspaceScope,
  id: string,
  input: PatchArticleInput,
): Promise<ArticleDto> {
  requireFound(await repo.findArticle(scope, id), 'article');

  if (input.slug !== undefined) {
    await assertUniqueArticleSlug(scope, input.slug, id);
  }

  const data: Parameters<typeof repo.updateArticle>[2] = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId;
  if (input.bodyHtml !== undefined) {
    data.bodyHtml = sanitizeArticleHtml(input.bodyHtml);
    data.bodyText = extractBodyText(data.bodyHtml);
  }

  const row = await repo.updateArticle(scope, id, data);
  return articleDto(row as Parameters<typeof articleDto>[0]);
}

export async function publishArticle(scope: WorkspaceScope, id: string): Promise<ArticleDto> {
  requireFound(await repo.findArticle(scope, id), 'article');
  const row = await repo.publishArticle(scope, id);
  return articleDto(row as Parameters<typeof articleDto>[0]);
}

export async function unpublishArticle(scope: WorkspaceScope, id: string): Promise<ArticleDto> {
  requireFound(await repo.findArticle(scope, id), 'article');
  const row = await repo.unpublishArticle(scope, id);
  return articleDto(row as Parameters<typeof articleDto>[0]);
}

// ─── Suggestions ───────────────────────────────────────────────────────────────

export async function getArticleSuggestions(
  scope: WorkspaceScope,
  q: string,
): Promise<SuggestionDto[]> {
  const rows = await repo.getArticleSuggestions(scope, q);
  return rows.map(suggestionDto);
}
