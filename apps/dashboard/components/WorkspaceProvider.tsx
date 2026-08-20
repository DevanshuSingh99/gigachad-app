'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ActiveWorkspaceContext,
  WORKSPACE_STORAGE_KEY,
  useMe,
  type ActiveWorkspace,
} from '@/lib/session';

/**
 * Holds the active workspace.
 *
 * The dashboard is a static export, which cannot serve an arbitrary dynamic path
 * segment like /w/:slug without a server to route it — so the active workspace
 * lives in client state and travels to the API as the `x-workspace-id` header,
 * which is exactly the mechanism docs/05-api.md specifies (validated against
 * membership before it is trusted). The trade-off is that a workspace-specific URL
 * is not deep-linkable; noted in the README.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Restored after mount rather than during render: localStorage does not exist
  // while the page is being prerendered at build time.
  useEffect(() => {
    setSelectedId(window.localStorage.getItem(WORKSPACE_STORAGE_KEY));
  }, []);

  const setWorkspaceId = useCallback((workspaceId: string) => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
    setSelectedId(workspaceId);
  }, []);

  const value = useMemo<ActiveWorkspace>(() => {
    const memberships = me.data?.memberships ?? [];
    // A stored id that is no longer a membership — the member was removed, or this
    // is a different account on the same browser — must not be trusted.
    const active =
      memberships.find((m) => m.workspaceId === selectedId) ?? memberships[0] ?? null;

    return {
      workspace: active,
      memberships,
      setWorkspaceId,
      isAdmin: active?.role === 'ADMIN',
    };
  }, [me.data, selectedId, setWorkspaceId]);

  return (
    <ActiveWorkspaceContext.Provider value={value}>{children}</ActiveWorkspaceContext.Provider>
  );
}
