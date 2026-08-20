'use client';

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
} from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api';

/** Query key factories — namespaced by workspace so switching workspaces clears cache. */
export const categoriesKey = (workspaceId: string) =>
  ['workspace', workspaceId, 'kb', 'categories'] as const;

export const articlesKey = (workspaceId: string, filters?: Partial<ArticleListQuery>) =>
  ['workspace', workspaceId, 'kb', 'articles', filters ?? {}] as const;

export const articleKey = (workspaceId: string, articleId: string) =>
  ['workspace', workspaceId, 'kb', 'article', articleId] as const;

// ─── Categories ────────────────────────────────────────────────────────────────

export function useCategories(workspaceId: string | undefined) {
  return useQuery({
    queryKey: categoriesKey(workspaceId ?? 'none'),
    queryFn: () =>
      apiFetch<CategoryDto[]>(`/api/v1/workspaces/${workspaceId}/kb/categories`),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateCategory(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<CategoryDto>(
        `/api/v1/workspaces/${workspaceId}/kb/categories`,
        { method: 'POST', body: input },
      ),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: categoriesKey(workspaceId) });
    },
  });
}

export function usePatchCategory(workspaceId: string | undefined, categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PatchCategoryInput) =>
      apiFetch<CategoryDto>(
        `/api/v1/workspaces/${workspaceId}/kb/categories/${categoryId}`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: categoriesKey(workspaceId) });
    },
  });
}

export function useDeleteCategory(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      apiFetch<void>(
        `/api/v1/workspaces/${workspaceId}/kb/categories/${categoryId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: categoriesKey(workspaceId) });
    },
  });
}

// ─── Articles ──────────────────────────────────────────────────────────────────

export function useArticles(
  workspaceId: string | undefined,
  filters: Partial<ArticleListQuery> = {},
) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();

  return useQuery({
    queryKey: articlesKey(workspaceId ?? 'none', filters),
    queryFn: () =>
      apiFetch<Page<ArticleSummaryDto>>(
        `/api/v1/workspaces/${workspaceId}/kb/articles${qs ? `?${qs}` : ''}`,
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useArticle(workspaceId: string | undefined, articleId: string | null) {
  return useQuery({
    queryKey: articleKey(workspaceId ?? 'none', articleId ?? 'none'),
    queryFn: () =>
      apiFetch<ArticleDto>(
        `/api/v1/workspaces/${workspaceId}/kb/articles/${articleId}`,
      ),
    enabled: Boolean(workspaceId && articleId),
  });
}

export function useCreateArticle(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArticleInput) =>
      apiFetch<ArticleDto>(
        `/api/v1/workspaces/${workspaceId}/kb/articles`,
        { method: 'POST', body: input },
      ),
    onSuccess: (article) => {
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: articlesKey(workspaceId) });
        queryClient.setQueryData(articleKey(workspaceId, article.id), article);
      }
    },
  });
}

export function usePatchArticle(workspaceId: string | undefined, articleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PatchArticleInput) =>
      apiFetch<ArticleDto>(
        `/api/v1/workspaces/${workspaceId}/kb/articles/${articleId}`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: (article) => {
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: articlesKey(workspaceId) });
        queryClient.setQueryData(articleKey(workspaceId, article.id), article);
      }
    },
  });
}

export function usePublishArticle(workspaceId: string | undefined, articleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ArticleDto>(
        `/api/v1/workspaces/${workspaceId}/kb/articles/${articleId}/publish`,
        { method: 'POST' },
      ),
    onSuccess: (article) => {
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: articlesKey(workspaceId) });
        queryClient.setQueryData(articleKey(workspaceId, article.id), article);
      }
    },
  });
}

export function useUnpublishArticle(workspaceId: string | undefined, articleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ArticleDto>(
        `/api/v1/workspaces/${workspaceId}/kb/articles/${articleId}/unpublish`,
        { method: 'POST' },
      ),
    onSuccess: (article) => {
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: articlesKey(workspaceId) });
        queryClient.setQueryData(articleKey(workspaceId, article.id), article);
      }
    },
  });
}

/** Slugifies a title for the auto-populated slug field. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}
