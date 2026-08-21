'use client';

import { Button, Chip, Select, SelectItem, Spinner } from '@heroui/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { RealtimeProvider } from '@/components/RealtimeProvider';
import { useActiveWorkspace, useLogout, useMe } from '@/lib/session';

/**
 * Frame for authenticated screens, plus the client-side auth gate.
 *
 * Nav is a bottom tab bar on phones and a sidebar from md up
 * (docs/15-frontend-and-widget.md).
 */
const NAV = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/kb', label: 'Knowledge Base' },
  { href: '/members', label: 'Team' },
  { href: '/domains', label: 'Domains' },
  { href: '/embed', label: 'Embed' },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const { workspace, memberships, setWorkspaceId, isAdmin } = useActiveWorkspace();
  const logout = useLogout();

  // A 401 is the signed-out state, so it redirects rather than rendering an error.
  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner aria-label="Loading" />
      </div>
    );
  }

  if (!me.data || !workspace) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <p className="text-default-500 text-sm">
          {me.data ? 'You are not a member of any workspace.' : 'Redirecting to sign in…'}
        </p>
      </div>
    );
  }

  return (
    <>
      <RealtimeProvider workspaceId={workspace.workspaceId} />
      {/*
        A fixed h-dvh, not min-h-dvh: min- lets the flex container grow past the
        viewport when content is tall, which pushes the whole page into scroll
        instead of confining it to the inner ScrollShadow regions — exactly the
        "composer scrolls out of reach" failure the responsive rules rule out
        (docs/15-frontend-and-widget.md).
      */}
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <aside className="border-divider flex shrink-0 flex-col gap-4 overflow-y-auto border-b p-4 md:w-60 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold tracking-tight">Gigachad</span>
            <Chip size="sm" variant="flat" color={isAdmin ? 'primary' : 'default'}>
              {workspace.role === 'ADMIN' ? 'Admin' : 'Agent'}
            </Chip>
          </div>

          {memberships.length > 1 ? (
            <Select
              size="sm"
              label="Workspace"
              selectedKeys={[workspace.workspaceId]}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {memberships.map((m) => (
                <SelectItem key={m.workspaceId}>{m.workspaceName}</SelectItem>
              ))}
            </Select>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{workspace.workspaceName}</p>
              <p className="text-default-400 truncate text-xs">{workspace.workspaceSlug}</p>
            </div>
          )}
          <p className="text-default-400 truncate text-xs" title={workspace.supportAddress}>
            {workspace.supportAddress}
          </p>

          <nav className="flex gap-1 md:flex-col">
            {NAV.map((item) => (
              <Button
                key={item.href}
                as={Link}
                href={item.href}
                size="sm"
                variant={pathname?.startsWith(item.href) ? 'flat' : 'light'}
                className="justify-start"
              >
                {item.label}
              </Button>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-1">
            <p className="text-default-400 truncate text-xs">{me.data.user.email}</p>
            <Button
              size="sm"
              variant="light"
              className="justify-start"
              isLoading={logout.isPending}
              onPress={() =>
                logout.mutate(undefined, { onSuccess: () => router.replace('/login') })
              }
            >
              Sign out
            </Button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </>
  );
}
