'use client';

import { Spinner } from '@heroui/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';

import { AppShell } from '@/components/AppShell';
import { ConversationDetail } from '@/components/inbox/ConversationDetail';
import { ConversationList } from '@/components/inbox/ConversationList';
import type { ConversationFilters } from '@/lib/inbox';

/**
 * The inbox: two panes at `md` and up, one pane with a back button below it
 * (docs/15-frontend-and-widget.md). Selection and filters live in the URL query
 * string rather than a dynamic path segment — a static export cannot serve
 * `/inbox/:conversationId` without a server to route it, the same constraint the
 * invitation-accept screen works around.
 */
function InboxScreen() {
  const params = useSearchParams();
  const router = useRouter();

  const conversationId = params.get('c');
  const filters: ConversationFilters = {
    channel: (params.get('channel') as ConversationFilters['channel']) || undefined,
    status: (params.get('status') as ConversationFilters['status']) || 'OPEN',
    assigneeId: params.get('assignee') || undefined,
  };

  const navigate = useCallback(
    (next: { c?: string | null; filters?: ConversationFilters }) => {
      const query = new URLSearchParams();
      const f = next.filters ?? filters;
      if (f.channel) query.set('channel', f.channel);
      if (f.status) query.set('status', f.status);
      if (f.assigneeId) query.set('assignee', f.assigneeId);
      const c = next.c !== undefined ? next.c : conversationId;
      if (c) query.set('c', c);
      const qs = query.toString();
      router.push(`/inbox${qs ? `?${qs}` : ''}`);
    },
    [conversationId, filters, router],
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[22rem_1fr]">
      {/* Below md: list and detail are separate views, not stacked — showing the
          detail pane hides the list entirely until Back is pressed. */}
      <div className={`min-h-0 ${conversationId ? 'hidden md:block' : 'block'}`}>
        <ConversationList
          filters={filters}
          onFiltersChange={(f) => navigate({ filters: f })}
          selectedId={conversationId}
          onSelect={(id) => navigate({ c: id })}
        />
      </div>
      <div className={`min-h-0 ${conversationId ? 'block' : 'hidden md:flex md:items-center md:justify-center'}`}>
        {conversationId ? (
          <ConversationDetail
            conversationId={conversationId}
            onBack={() => navigate({ c: null })}
          />
        ) : (
          <p className="text-default-400 text-sm">Select a conversation.</p>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            <Spinner aria-label="Loading" />
          </div>
        }
      >
        <InboxScreen />
      </Suspense>
    </AppShell>
  );
}
