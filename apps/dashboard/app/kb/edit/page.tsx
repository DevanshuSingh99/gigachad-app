'use client';

import {
  Button,
  Chip,
  Input,
  ScrollShadow,
  Skeleton,
  Spinner,
  Switch,
} from '@heroui/react';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { AppShell } from '@/components/AppShell';
import { ArticleBodyEditor } from '@/components/kb/ArticleBodyEditor';
import { NativeSelect } from '@/components/NativeSelect';
import {
  slugify,
  useArticle,
  useCategories,
  usePatchArticle,
  usePublishArticle,
  useUnpublishArticle,
} from '@/lib/kb';
import { useActiveWorkspace } from '@/lib/session';

/**
 * The article editor. Selection lives in the `id` query param, not a dynamic
 * path segment — this dashboard is `output: 'export'` (docs/11-tradeoffs.md),
 * and a static export has no server to resolve `/kb/:articleId` for an id that
 * only exists after deploy (the same constraint `/inbox`'s `c` param and the
 * invitation-accept screen already work around). A `[articleId]` dynamic
 * segment here previously crashed at request time with "Objects are not valid
 * as a React child" — this Next build has no `generateStaticParams` story for
 * post-deploy ids, and `useParams()` has no valid value to resolve outside of
 * one. The query-string form sidesteps the problem entirely.
 */
function ArticleEditorScreen({ articleId }: { articleId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;

  const article = useArticle(workspaceId, articleId);
  const categories = useCategories(workspaceId);
  const patch = usePatchArticle(workspaceId, articleId);
  const publish = usePublishArticle(workspaceId, articleId);
  const unpublish = useUnpublishArticle(workspaceId, articleId);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('__none__');
  const [bodyHtml, setBodyHtml] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Populate form when article loads.
  useEffect(() => {
    if (!article.data) return;
    setTitle(article.data.title);
    setSlug(article.data.slug);
    setCategoryId(article.data.categoryId ?? '__none__');
    setBodyHtml(article.data.bodyHtml);
    setDirty(false);
  }, [article.data]);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slugEdited) setSlug(slugify(v));
    setDirty(true);
  };

  const save = async () => {
    const changes: Record<string, unknown> = {};
    if (title !== article.data?.title) changes.title = title;
    if (slug !== article.data?.slug) changes.slug = slug;
    const resolvedCategoryId = categoryId === '__none__' ? null : categoryId;
    if (resolvedCategoryId !== article.data?.categoryId)
      changes.categoryId = resolvedCategoryId;
    if (bodyHtml !== article.data?.bodyHtml) changes.bodyHtml = bodyHtml;
    if (Object.keys(changes).length === 0) { setDirty(false); return; }

    await patch.mutateAsync(changes as Parameters<typeof patch.mutateAsync>[0]);
    setDirty(false);
  };

  if (article.isPending) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-1/2 rounded-large" />
        <Skeleton className="h-64 w-full rounded-large" />
      </div>
    );
  }

  if (!article.data) {
    return (
      <p className="text-default-500 p-6 text-sm">Article not found.</p>
    );
  }

  const a = article.data;
  const isPublished = a.status === 'PUBLISHED';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header toolbar */}
      <header className="border-divider flex flex-wrap items-center gap-2 border-b p-3">
        <Button as={Link} href="/kb" size="sm" variant="light">
          ← Articles
        </Button>
        <div className="flex-1" />
        <Chip size="sm" color={isPublished ? 'success' : 'default'} variant="flat">
          {isPublished ? 'Published' : 'Draft'}
        </Chip>
        <Switch
          size="sm"
          isSelected={isPublished}
          isDisabled={publish.isPending || unpublish.isPending}
          onValueChange={(v) => {
            if (v) publish.mutate();
            else unpublish.mutate();
          }}
          aria-label="Published"
        >
          {isPublished ? 'Unpublish' : 'Publish'}
        </Switch>
        <Button
          size="sm"
          color="primary"
          isLoading={patch.isPending}
          isDisabled={!dirty}
          onPress={save}
        >
          Save
        </Button>
      </header>

      {patch.isError ? (
        <div className="bg-danger-50 text-danger border-danger-200 border-b px-4 py-2 text-sm">
          Failed to save. Check the fields and try again.
        </div>
      ) : null}

      <ScrollShadow className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          {/* Title */}
          <Input
            label="Title"
            value={title}
            onValueChange={handleTitleChange}
            isRequired
            classNames={{ input: 'text-lg font-semibold' }}
          />

          {/* Slug + Category — side by side on md+ */}
          <div className="flex flex-col gap-4 md:flex-row">
            <Input
              label="Slug"
              value={slug}
              onValueChange={(v) => { setSlug(v); setSlugEdited(true); setDirty(true); }}
              description="Used in the public URL"
              className="flex-1"
            />
            <NativeSelect
              aria-label="Category"
              className="h-14 flex-1"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value || '__none__');
                setDirty(true);
              }}
            >
              <option value="__none__">Uncategorized</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <ArticleBodyEditor
            initialHtml={a.bodyHtml}
            onChange={(html) => {
              setBodyHtml(html);
              setDirty(true);
            }}
          />
        </div>
      </ScrollShadow>
    </div>
  );
}

function ArticleEditorRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const articleId = params.get('id');

  useEffect(() => {
    if (!articleId) router.replace('/kb');
  }, [articleId, router]);

  if (!articleId) return null;

  return <ArticleEditorScreen articleId={articleId} />;
}

export default function ArticleEditorPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            <Spinner aria-label="Loading" />
          </div>
        }
      >
        <ArticleEditorRoute />
      </Suspense>
    </AppShell>
  );
}
