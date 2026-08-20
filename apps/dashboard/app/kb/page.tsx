'use client';

import {
  Button,
  Chip,
  Input,
  ScrollShadow,
  Select,
  SelectItem,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from '@heroui/react';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { useArticles, useCategories } from '@/lib/kb';
import { useActiveWorkspace } from '@/lib/session';

const STATUS_COLOR = {
  PUBLISHED: 'success',
  DRAFT: 'default',
} as const;

function KbScreen() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'PUBLISHED' | 'DRAFT' | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('__all__');

  const categories = useCategories(workspaceId);
  const articles = useArticles(workspaceId, {
    ...(search ? { search } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(categoryFilter !== '__all__' ? { categoryId: categoryFilter } : {}),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-divider flex flex-wrap items-center gap-3 border-b p-4">
        <h1 className="flex-1 text-lg font-semibold">Knowledge Base</h1>
        <Button
          as={Link}
          href="/kb/new"
          color="primary"
          size="sm"
        >
          New article
        </Button>
      </header>

      <div className="border-divider flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Input
          size="sm"
          placeholder="Search articles…"
          value={search}
          onValueChange={setSearch}
          className="w-56"
          isClearable
          onClear={() => setSearch('')}
        />
        <Select
          size="sm"
          className="w-36"
          selectedKeys={[statusFilter || '__all__']}
          onChange={(e) => setStatusFilter(e.target.value === '__all__' ? '' : e.target.value as 'PUBLISHED' | 'DRAFT')}
        >
          <SelectItem key="__all__">All statuses</SelectItem>
          <SelectItem key="PUBLISHED">Published</SelectItem>
          <SelectItem key="DRAFT">Draft</SelectItem>
        </Select>
        <Select
          size="sm"
          placeholder="All categories"
          className="w-44"
          selectedKeys={[categoryFilter]}
          onChange={(e) => setCategoryFilter(e.target.value || '__all__')}
        >
          {[
            { id: '__all__', name: 'All categories' },
            ...(categories.data ?? []),
          ].map((c) => (
            <SelectItem key={c.id}>{c.name}</SelectItem>
          ))}
        </Select>
      </div>

      <ScrollShadow className="min-h-0 flex-1 overflow-auto">
        {articles.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-large" />
            ))}
          </div>
        ) : !articles.data || articles.data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-default-500 text-sm">No articles yet.</p>
            <Button as={Link} href="/kb/new" color="primary" size="sm">
              Write your first article
            </Button>
          </div>
        ) : (
          <Table
            aria-label="Articles"
            removeWrapper
            className="w-full"
            onRowAction={(key) => router.push(`/kb/edit?id=${String(key)}`)}
          >
            <TableHeader>
              <TableColumn>Title</TableColumn>
              <TableColumn className="hidden md:table-cell">Category</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn className="hidden md:table-cell">Updated</TableColumn>
            </TableHeader>
            <TableBody>
              {articles.data.items.map((a) => (
                <TableRow key={a.id} className="cursor-pointer">
                  <TableCell>
                    <span className="font-medium">{a.title}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-default-500 text-sm">{a.categoryName ?? '—'}</span>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" color={STATUS_COLOR[a.status]} variant="flat">
                      {a.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                    </Chip>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-default-400 text-xs">
                      {new Date(a.updatedAt).toLocaleDateString()}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollShadow>
    </div>
  );
}

export default function KbPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            <Spinner aria-label="Loading" />
          </div>
        }
      >
        <KbScreen />
      </Suspense>
    </AppShell>
  );
}
