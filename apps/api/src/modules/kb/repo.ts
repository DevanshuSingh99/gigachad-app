import type { ArticleStatus } from '@gigachad/shared';

import { db, type Tx, unscoped } from '../../db';
import type { WorkspaceScope } from '../../lib/repo';
import type { ArticleRow, CategoryRow, SuggestionRow } from './dto';

// ─── Category selects ──────────────────────────────────────────────────────────

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { articles: true } },
} as const;

// ─── Categories ────────────────────────────────────────────────────────────────

export function listCategories(scope: WorkspaceScope) {
  return db.knowledgeCategory.findMany({
    where: { workspaceId: scope.workspaceId },
    select: CATEGORY_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export function findCategory(scope: WorkspaceScope, id: string) {
  return db.knowledgeCategory.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    select: CATEGORY_SELECT,
  });
}

export function findCategoryBySlug(scope: WorkspaceScope, slug: string) {
  return db.knowledgeCategory.findFirst({
    where: { workspaceId: scope.workspaceId, slug },
    select: { id: true },
  });
}

export function createCategory(
  scope: WorkspaceScope,
  data: { name: string; slug: string; sortOrder: number },
) {
  return db.knowledgeCategory.create({
    data: { workspaceId: scope.workspaceId, ...data },
    select: CATEGORY_SELECT,
  });
}

export function updateCategory(
  scope: WorkspaceScope,
  id: string,
  data: { name?: string; slug?: string; sortOrder?: number },
) {
  return db.knowledgeCategory.update({
    where: { id, workspaceId: scope.workspaceId },
    data,
    select: CATEGORY_SELECT,
  });
}

export async function deleteCategory(scope: WorkspaceScope, id: string): Promise<void> {
  await db.knowledgeCategory.delete({ where: { id, workspaceId: scope.workspaceId } });
}

export async function countArticlesInCategory(
  scope: WorkspaceScope,
  categoryId: string,
): Promise<number> {
  return db.knowledgeArticle.count({
    where: { workspaceId: scope.workspaceId, categoryId },
  });
}

// ─── Article selects ───────────────────────────────────────────────────────────

const ARTICLE_SUMMARY_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  categoryId: true,
  category: { select: { name: true } },
  authorId: true,
  author: { select: { name: true } },
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ARTICLE_FULL_SELECT = {
  ...ARTICLE_SUMMARY_SELECT,
  bodyHtml: true,
  bodyText: true,
} as const;

// ─── Articles ──────────────────────────────────────────────────────────────────

export function listArticles(
  scope: WorkspaceScope,
  filters: { status?: ArticleStatus; categoryId?: string; search?: string },
  opts: { take: number; afterCursor?: { updatedAt: Date; id: string } },
) {
  return db.knowledgeArticle.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.search
        ? { title: { contains: filters.search, mode: 'insensitive' } }
        : {}),
      ...(opts.afterCursor
        ? {
            OR: [
              { updatedAt: { lt: opts.afterCursor.updatedAt } },
              { updatedAt: opts.afterCursor.updatedAt, id: { lt: opts.afterCursor.id } },
            ],
          }
        : {}),
    },
    select: ARTICLE_SUMMARY_SELECT,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: opts.take,
  });
}

export function findArticle(scope: WorkspaceScope, id: string) {
  return db.knowledgeArticle.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    select: ARTICLE_FULL_SELECT,
  });
}

export function findArticleBySlugInWorkspace(
  client: Tx,
  scope: WorkspaceScope,
  slug: string,
) {
  return client.knowledgeArticle.findFirst({
    where: { workspaceId: scope.workspaceId, slug },
    select: { id: true },
  });
}

export function createArticle(
  scope: WorkspaceScope,
  data: {
    title: string;
    slug: string;
    categoryId?: string | null;
    bodyHtml: string;
    bodyText: string;
    authorId: string;
  },
) {
  return db.knowledgeArticle.create({
    data: {
      workspaceId: scope.workspaceId,
      title: data.title,
      slug: data.slug,
      ...(data.categoryId != null ? { categoryId: data.categoryId } : {}),
      bodyHtml: data.bodyHtml,
      bodyText: data.bodyText,
      authorId: data.authorId,
    },
    select: ARTICLE_FULL_SELECT,
  });
}

export function updateArticle(
  scope: WorkspaceScope,
  id: string,
  data: {
    title?: string;
    slug?: string;
    categoryId?: string | null;
    bodyHtml?: string;
    bodyText?: string;
  },
) {
  return db.knowledgeArticle.update({
    where: { id, workspaceId: scope.workspaceId },
    data,
    select: ARTICLE_FULL_SELECT,
  });
}

export function publishArticle(scope: WorkspaceScope, id: string) {
  return db.knowledgeArticle.update({
    where: { id, workspaceId: scope.workspaceId },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
    select: ARTICLE_FULL_SELECT,
  });
}

export function unpublishArticle(scope: WorkspaceScope, id: string) {
  return db.knowledgeArticle.update({
    where: { id, workspaceId: scope.workspaceId },
    data: { status: 'DRAFT', publishedAt: null },
    select: ARTICLE_FULL_SELECT,
  });
}

// ─── Public KB ────────────────────────────────────────────────────────────────

/**
 * Resolves a workspace for the public KB from either:
 * - a slug segment in the URL (`/kb/:slug/...`)
 * - or the `Host` header (verified custom domain — Phase H)
 *
 * Always cross-tenant, so wrapped in unscoped().
 */
export function findPublicWorkspace(slugOrHostname: string, byHost = false) {
  return unscoped('resolve workspace for public KB', () =>
    db.workspace.findFirst({
      where: byHost
        ? { customDomains: { some: { hostname: slugOrHostname, status: 'VERIFIED' } } }
        : { slug: slugOrHostname },
      select: { id: true, name: true, slug: true },
    }),
  );
}

/** Full-text search on published articles — `websearch_to_tsquery` + `ts_rank`. */
export async function searchPublishedArticles(
  scope: WorkspaceScope,
  query: string,
): Promise<ArticleRow[]> {
  return db.$queryRaw<ArticleRow[]>`
    SELECT
      a.id,
      a.title,
      a.slug,
      a.status,
      a.category_id AS "categoryId",
      a.author_id AS "authorId",
      a.published_at AS "publishedAt",
      a.created_at AS "createdAt",
      a.updated_at AS "updatedAt",
      NULL::text AS "bodyHtml",
      NULL::text AS "bodyText",
      ts_rank(a.search_vector, websearch_to_tsquery('english', ${query})) AS _rank
    FROM knowledge_articles a
    WHERE a.workspace_id = ${scope.workspaceId}::uuid
      AND a.status = 'PUBLISHED'::"ArticleStatus"
      AND a.search_vector @@ websearch_to_tsquery('english', ${query})
    ORDER BY _rank DESC
    LIMIT 20
  `;
}

export function listPublishedArticles(
  scope: WorkspaceScope,
  filters: { categoryId?: string },
) {
  return db.knowledgeArticle.findMany({
    where: {
      workspaceId: scope.workspaceId,
      status: 'PUBLISHED',
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    },
    select: ARTICLE_SUMMARY_SELECT,
    orderBy: [{ publishedAt: 'desc' }],
    take: 50,
  });
}

export function listPublishedCategories(scope: WorkspaceScope) {
  return db.knowledgeCategory.findMany({
    where: {
      workspaceId: scope.workspaceId,
      articles: { some: { status: 'PUBLISHED' } },
    },
    select: { id: true, name: true, slug: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export function findPublishedArticleBySlug(scope: WorkspaceScope, slug: string) {
  return db.knowledgeArticle.findFirst({
    where: { workspaceId: scope.workspaceId, slug, status: 'PUBLISHED' },
    select: {
      ...ARTICLE_FULL_SELECT,
      category: { select: { name: true, slug: true } },
    },
  });
}

// ─── Widget suggestions ────────────────────────────────────────────────────────

/**
 * Prefix + trigram suggestion search for the widget panel.
 *
 * Two-path query:
 *  1. Prefix: `to_tsquery('english', 'term:*')` on `search_vector` — catches
 *     whole-word prefixes mid-word (e.g. typing "refun" returns "refund").
 *     Uses the `english` config, matching the config `search_vector`'s
 *     generated column was built with (see the `_init` migration) — a
 *     `simple`-config query against an `english`-stemmed column silently
 *     misses anything stemming changes, e.g. "cancella" never matching
 *     "cancellation" (which stems to "cancel").
 *  2. Trigram: `pg_trgm similarity` on `title` — catches partial/fuzzy matches
 *     (e.g. "cancl" returns "cancellation").
 *
 * The UNION is deduplicated by id (keeping the better-priority row per id) in
 * an inner query, then the DEDUPED set is re-sorted by relevance (priority,
 * then each tier's own rank/similarity score) in an outer query — `DISTINCT
 * ON`'s own `ORDER BY id, priority` is only for picking which duplicate
 * survives, and is not relevance order, so it can't be the final sort.
 * Published-only, scoped to the workspace (invariants 1 and 5).
 */
export async function getArticleSuggestions(
  scope: WorkspaceScope,
  q: string,
): Promise<SuggestionRow[]> {
  const tokens = q.trim().split(/\s+/);
  const lastToken = tokens[tokens.length - 1] ?? '';
  if (!lastToken) return [];

  // `to_tsquery` (unlike `websearch_to_tsquery`/`plainto_tsquery`, used for the
  // main search above) requires strict tsquery syntax — raw user input
  // containing '&', '|', '!', parens, or a bare trailing ':' throws a Postgres
  // syntax error. Strip everything but letters/digits/underscore before it
  // reaches the query.
  const sanitizedToken = lastToken.replace(/[^\p{L}\p{N}_]/gu, '');

  if (!sanitizedToken) {
    // Nothing prefix-safe survived sanitization (e.g. the query was pure
    // punctuation) — fall back to trigram-only matching rather than passing an
    // empty string into `to_tsquery`.
    return db.$queryRaw<SuggestionRow[]>`
      SELECT id, title, slug FROM (
        SELECT DISTINCT ON (id) id, title, slug, similarity(title, ${q}) AS score
        FROM knowledge_articles
        WHERE workspace_id = ${scope.workspaceId}::uuid
          AND status = 'PUBLISHED'::"ArticleStatus"
          AND similarity(title, ${q}) > 0.1
        ORDER BY id, score DESC
      ) deduped
      ORDER BY score DESC
      LIMIT 5
    `;
  }

  const prefixQuery = `${sanitizedToken}:*`;

  return db.$queryRaw<SuggestionRow[]>`
    SELECT id, title, slug FROM (
      SELECT DISTINCT ON (id) id, title, slug, priority, score
      FROM (
        SELECT id, title, slug, 1 AS priority,
               ts_rank(search_vector, to_tsquery('english', ${prefixQuery})) AS score
        FROM knowledge_articles
        WHERE workspace_id = ${scope.workspaceId}::uuid
          AND status = 'PUBLISHED'::"ArticleStatus"
          AND search_vector @@ to_tsquery('english', ${prefixQuery})
        UNION ALL
        SELECT id, title, slug, 2 AS priority,
               similarity(title, ${q}) AS score
        FROM knowledge_articles
        WHERE workspace_id = ${scope.workspaceId}::uuid
          AND status = 'PUBLISHED'::"ArticleStatus"
          AND similarity(title, ${q}) > 0.1
      ) combined
      ORDER BY id, priority
    ) deduped
    ORDER BY priority, score DESC
    LIMIT 5
  `;
}
