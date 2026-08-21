'use client';

import { Button, Input, ScrollShadow, Spinner } from '@heroui/react';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { ArticleBodyEditor } from '@/components/kb/ArticleBodyEditor';
import { NativeSelect } from '@/components/NativeSelect';
import { slugify, useCategories, useCreateArticle } from '@/lib/kb';
import { useActiveWorkspace } from '@/lib/session';

function NewArticleScreen() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const router = useRouter();

  const categories = useCategories(workspaceId);
  const create = useCreateArticle(workspaceId);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('__none__');
  const [bodyHtml, setBodyHtml] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const submit = () => {
    if (!title.trim() || !slug.trim() || !bodyHtml.trim()) return;
    create.mutate(
      {
        title: title.trim(),
        slug: slug.trim(),
        categoryId: categoryId === '__none__' ? undefined : categoryId,
        bodyHtml,
      },
      {
        onSuccess: (article) => router.push(`/kb/edit?id=${article.id}`),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-divider flex items-center gap-2 border-b p-3">
        <Button as={Link} href="/kb" size="sm" variant="light">
          ← Articles
        </Button>
        <span className="flex-1 font-medium">New article</span>
        <Button
          size="sm"
          color="primary"
          isLoading={create.isPending}
          isDisabled={!title.trim() || !slug.trim() || !bodyHtml.trim()}
          onPress={submit}
        >
          Create
        </Button>
      </header>

      {create.isError ? (
        <div className="bg-danger-50 text-danger border-danger-200 border-b px-4 py-2 text-sm">
          Failed to create article. Check the fields and try again.
        </div>
      ) : null}

      <ScrollShadow className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <Input
            label="Title"
            value={title}
            onValueChange={handleTitleChange}
            isRequired
            autoFocus
            classNames={{ input: 'text-lg font-semibold' }}
          />

          <div className="flex flex-col gap-4 md:flex-row">
            <Input
              label="Slug"
              value={slug}
              onValueChange={(v) => { setSlug(v); setSlugEdited(true); }}
              description="Used in the public URL"
              className="flex-1"
              isRequired
            />
            <NativeSelect
              aria-label="Category"
              className="h-14 flex-1"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value || '__none__')}
            >
              <option value="__none__">Uncategorized</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <ArticleBodyEditor onChange={setBodyHtml} />
        </div>
      </ScrollShadow>
    </div>
  );
}

export default function NewArticlePage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            <Spinner aria-label="Loading" />
          </div>
        }
      >
        <NewArticleScreen />
      </Suspense>
    </AppShell>
  );
}
