import { Router } from 'express';
import {
  articleListQuery,
  createArticleInput,
  createCategoryInput,
  patchArticleInput,
  patchCategoryInput,
  uuid,
} from '@gigachad/shared';
import { z } from 'zod';

import { authOf, membershipOf, requireAdmin, requireMember } from '../../middleware/requireAuth';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import * as service from './service';

/**
 * KB routes, mounted under /workspaces/:workspaceId/kb by the workspaces router.
 * mergeParams is needed so :workspaceId is visible to the auth middleware.
 */
export const kbRouter = Router({ mergeParams: true });

const categoryParams = z.object({ workspaceId: uuid, categoryId: uuid });
const articleParams = z.object({ workspaceId: uuid, articleId: uuid });

// ─── Categories ────────────────────────────────────────────────────────────────

kbRouter.get('/categories', requireMember, async (req, res) => {
  res.json({ data: await service.listCategories(membershipOf(req)) });
});

kbRouter.post('/categories', requireMember, async (req, res) => {
  const input = parseBody(req, createCategoryInput);
  res.status(201).json({ data: await service.createCategory(membershipOf(req), input) });
});

kbRouter.patch('/categories/:categoryId', requireMember, async (req, res) => {
  const { categoryId } = parseParams(req, categoryParams);
  const input = parseBody(req, patchCategoryInput);
  res.json({ data: await service.patchCategory(membershipOf(req), categoryId, input) });
});

kbRouter.delete('/categories/:categoryId', requireAdmin, async (req, res) => {
  const { categoryId } = parseParams(req, categoryParams);
  await service.deleteCategory(membershipOf(req), categoryId);
  res.status(204).end();
});

// ─── Articles ──────────────────────────────────────────────────────────────────

kbRouter.get('/articles', requireMember, async (req, res) => {
  const query = parseQuery(req, articleListQuery);
  res.json({ data: await service.listArticles(membershipOf(req), query) });
});

kbRouter.post('/articles', requireMember, async (req, res) => {
  const input = parseBody(req, createArticleInput);
  res.status(201).json({
    data: await service.createArticle(membershipOf(req), input, authOf(req).userId),
  });
});

kbRouter.get('/articles/:articleId', requireMember, async (req, res) => {
  const { articleId } = parseParams(req, articleParams);
  res.json({ data: await service.getArticle(membershipOf(req), articleId) });
});

kbRouter.patch('/articles/:articleId', requireMember, async (req, res) => {
  const { articleId } = parseParams(req, articleParams);
  const input = parseBody(req, patchArticleInput);
  res.json({ data: await service.patchArticle(membershipOf(req), articleId, input) });
});

kbRouter.post('/articles/:articleId/publish', requireMember, async (req, res) => {
  const { articleId } = parseParams(req, articleParams);
  res.json({ data: await service.publishArticle(membershipOf(req), articleId) });
});

kbRouter.post('/articles/:articleId/unpublish', requireMember, async (req, res) => {
  const { articleId } = parseParams(req, articleParams);
  res.json({ data: await service.unpublishArticle(membershipOf(req), articleId) });
});
