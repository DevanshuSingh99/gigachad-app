import path from 'node:path';

import { Router } from 'express';
import { Eta } from 'eta';
import { searchQuery, slug as slugSchema } from '@gigachad/shared';

import { env } from '../../env';
import { logger } from '../../lib/logger';
import { rateLimit } from '../../lib/rateLimit';
import { escapeHtml } from '../../lib/sanitize';
import * as repo from './repo';

/**
 * Public Knowledge Base routes.
 *
 * Two resolution paths, one handler set (docs/05-api.md):
 *   - Slug segment: `GET /api/v1/public/:workspaceSlug/kb`
 *   - Host header: when the request arrives on a verified custom domain (Phase H
 *     wires the Host-header path; the slug path works now).
 *
 * Published articles only — never drafts — on every public path.
 */

const eta = new Eta({
  views: path.join(__dirname, '../../kb-web'),
  cache: env.isProduction,
  // Makes `escapeHtml` available as a plain function call inside every .eta
  // template rendered by this instance. `.eta` files can't `import` a TS
  // module directly, but Eta's `functionHeader` inserts raw JS at the top of
  // the compiled template function — `Function.prototype.toString()` is safe
  // here because `escapeHtml` is a pure, self-contained function with no
  // closure references. See docs on `index.eta`/`article.eta` for why this
  // (rather than `sanitizeArticleHtml`) is the escaping used for plain-text
  // interpolations like titles, category names, and the search query.
  functionHeader: `const escapeHtml = ${escapeHtml.toString()};`,
});

/**
 * Parses the public search/category query params defensively. This is a public,
 * unauthenticated page, not an API for a trusted client — malformed or oversized
 * input should degrade to "no filter" rather than a 400 error page.
 */
function parseSearchParam(raw: unknown): string | undefined {
  const parsed = searchQuery.safeParse(raw);
  return parsed.success && parsed.data ? parsed.data : undefined;
}

function parseCategoryParam(raw: unknown): string | undefined {
  const parsed = slugSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export const publicKbRouter = Router({ mergeParams: true });

/** Renders HTML or throws. Used by both resolution paths. */
async function renderIndex(
  workspaceId: string,
  workspaceName: string,
  kbRoot: string,
  search: string | undefined,
  categorySlug: string | undefined,
  res: import('express').Response,
): Promise<void> {
  const scope = { workspaceId };

  let articles;
  if (search) {
    const rows = await repo.searchPublishedArticles(scope, search);
    articles = rows.map((a) => ({
      id: String(a.id),
      title: String(a.title),
      slug: String(a.slug),
      categoryName: null as string | null,
    }));
  } else {
    let categoryId: string | undefined;
    if (categorySlug) {
      const cat = await repo.listPublishedCategories(scope);
      const found = cat.find((c) => c.slug === categorySlug);
      categoryId = found?.id;
    }
    const rows = await repo.listPublishedArticles(scope, { categoryId });
    articles = rows.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      categoryName: (a as { category?: { name: string } | null }).category?.name ?? null,
    }));
  }

  const categories = await repo.listPublishedCategories(scope);

  const html = await eta.renderAsync('index', {
    workspaceName,
    kbRoot,
    search,
    activeCategorySlug: categorySlug,
    categories,
    articles,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

async function renderArticle(
  workspaceId: string,
  workspaceName: string,
  kbRoot: string,
  slug: string,
  res: import('express').Response,
): Promise<void> {
  const scope = { workspaceId };
  const article = await repo.findPublishedArticleBySlug(scope, slug);

  if (!article) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><title>Not Found</title></head><body><h1>Article not found.</h1><p><a href="${kbRoot}">Back to help center</a></p></body></html>`);
    return;
  }

  const cat = (article as { category?: { name: string; slug: string } | null }).category;

  const html = await eta.renderAsync('article', {
    workspaceName,
    kbRoot,
    article: {
      title: article.title,
      bodyHtml: article.bodyHtml,
      categoryName: cat?.name ?? null,
      categorySlug: cat?.slug ?? null,
    },
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ─── Slug-based routes ────────────────────────────────────────────────────────

publicKbRouter.get(
  '/:workspaceSlug/kb',
  rateLimit('publicKbSearch', (req) => req.ip ?? 'unknown'),
  async (req, res) => {
    const { workspaceSlug } = req.params;
    const search = parseSearchParam(req.query.search);
    const categorySlug = parseCategoryParam(req.query.category);

    const slug = Array.isArray(workspaceSlug) ? (workspaceSlug[0] ?? '') : (workspaceSlug ?? '');
    const workspace = await repo.findPublicWorkspace(slug, false);
    if (!workspace) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
      return;
    }

    const kbRoot = `/api/v1/public/${slug}/kb`;
    await renderIndex(workspace.id, workspace.name, kbRoot, search, categorySlug, res);
  },
);

publicKbRouter.get(
  '/:workspaceSlug/kb/articles/:articleSlug',
  rateLimit('publicKbSearch', (req) => req.ip ?? 'unknown'),
  async (req, res) => {
    const { workspaceSlug, articleSlug } = req.params;
    const slug = Array.isArray(workspaceSlug) ? (workspaceSlug[0] ?? '') : (workspaceSlug ?? '');
    const artSlug = Array.isArray(articleSlug) ? (articleSlug[0] ?? '') : (articleSlug ?? '');
    const workspace = await repo.findPublicWorkspace(slug, false);
    if (!workspace) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
      return;
    }
    const kbRoot = `/api/v1/public/${slug}/kb`;
    await renderArticle(workspace.id, workspace.name, kbRoot, artSlug, res);
  },
);

// ─── Host-header resolution (Phase H custom domains) ─────────────────────────
//
// Mounted separately in app.ts: when a request arrives on a verified custom
// hostname, resolve the workspace from the Host header and serve the same
// templates. The routes are identical to the slug-based ones above; only the
// workspace resolution differs.

export const customDomainKbRouter = Router();

customDomainKbRouter.get(
  '/',
  rateLimit('publicKbSearch', (req) => req.ip ?? 'unknown'),
  async (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    if (!host) { res.status(404).end(); return; }

    const workspace = await repo.findPublicWorkspace(host, true);
    if (!workspace) { res.status(404).end(); return; }

    const kbRoot = '';
    const search = parseSearchParam(req.query.search);
    const categorySlug = parseCategoryParam(req.query.category);
    await renderIndex(workspace.id, workspace.name, kbRoot, search, categorySlug, res);
  },
);

customDomainKbRouter.get(
  '/articles/:articleSlug',
  rateLimit('publicKbSearch', (req) => req.ip ?? 'unknown'),
  async (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    if (!host) { res.status(404).end(); return; }

    const workspace = await repo.findPublicWorkspace(host, true);
    if (!workspace) { res.status(404).end(); return; }

    const { articleSlug } = req.params;
    const artSlug = Array.isArray(articleSlug) ? (articleSlug[0] ?? '') : (articleSlug ?? '');
    await renderArticle(workspace.id, workspace.name, '', artSlug, res);
  },
);
