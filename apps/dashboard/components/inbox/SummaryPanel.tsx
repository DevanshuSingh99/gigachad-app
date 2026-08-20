'use client';

import { Button, Chip, Divider, Skeleton } from '@heroui/react';
import type { SummaryDto } from '@gigachad/shared';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { invalidateSummary, useSummary, useTriggerSummary } from '@/lib/ai';
import { useActiveWorkspace } from '@/lib/session';
import { getSocket } from '@/lib/socket';

/**
 * AI summary panel shown in the conversation detail rail.
 *
 * Display states per docs/08-ai.md, plus `eligible`:
 *   below_threshold — not enough messages (or, with errorCode AI_UNAVAILABLE,
 *                     AI is disabled entirely — distinguished in the render below)
 *   eligible        — enough messages, but no summary has ever been generated
 *   queued          — job in flight (skeleton)
 *   ready           — fresh, 3-field summary
 *   stale           — previous summary + "new messages" badge + Refresh
 *   error           — previous summary if available + retry + reason
 *
 * `summary:updated` socket events invalidate the query so the panel refreshes
 * automatically when the worker completes, without polling.
 */
export function SummaryPanel({ conversationId }: { conversationId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const queryClient = useQueryClient();

  const summary = useSummary(workspaceId, conversationId);
  const trigger = useTriggerSummary(workspaceId, conversationId);

  // Invalidate on `summary:updated` socket event.
  useEffect(() => {
    if (!workspaceId) return;
    const socket = getSocket(workspaceId);
    const onUpdated = (payload: { conversationId: string }) => {
      if (payload.conversationId === conversationId) {
        invalidateSummary(queryClient, workspaceId, conversationId);
      }
    };
    socket.on('summary:updated', onUpdated);
    return () => { socket.off('summary:updated', onUpdated); };
  }, [workspaceId, conversationId, queryClient]);

  const data: SummaryDto | undefined = summary.data;

  return (
    <section aria-label="AI summary" className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">AI Summary</span>
        {data &&
        data.state !== 'below_threshold' &&
        data.state !== 'eligible' &&
        data.state !== 'queued' ? (
          <Button
            size="sm"
            variant="flat"
            isLoading={trigger.isPending}
            onPress={() => trigger.mutate()}
          >
            {data.state === 'error' ? 'Retry' : 'Refresh'}
          </Button>
        ) : null}
      </div>

      <Divider />

      {summary.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-2/3 rounded" />
        </div>
      ) : !data ? (
        <div className="text-default-400 text-xs">
          <p>Unable to load summary.</p>
        </div>
      ) : data.state === 'below_threshold' ? (
        <div className="text-default-400 text-xs">
          <p>
            {data.errorCode === 'AI_UNAVAILABLE'
              ? 'AI summaries are not available right now.'
              : 'Need at least 6 messages to generate a summary.'}
          </p>
        </div>
      ) : data.state === 'eligible' ? (
        <div className="text-default-400 text-xs">
          <p>No summary yet.</p>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            className="mt-2"
            isLoading={trigger.isPending}
            onPress={() => trigger.mutate()}
          >
            Generate
          </Button>
        </div>
      ) : data.state === 'queued' ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <p className="text-default-400 text-xs">Generating summary…</p>
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-4 w-2/3 rounded" />
        </div>
      ) : (
        <SummaryContent data={data} onGenerate={() => trigger.mutate()} isPending={trigger.isPending} />
      )}
    </section>
  );
}

function SummaryContent({
  data,
  onGenerate,
  isPending,
}: {
  data: SummaryDto;
  onGenerate: () => void;
  isPending: boolean;
}) {
  const hasContent = data.userWants || data.tried || data.currentStatus;

  return (
    <div className="flex flex-col gap-3">
      {data.state === 'stale' ? (
        <div className="flex items-center gap-2">
          <Chip size="sm" color="warning" variant="flat">
            New messages since last summary
          </Chip>
        </div>
      ) : null}

      {data.state === 'error' ? (
        <div className="text-danger text-xs">
          <p>Last attempt failed. {hasContent ? 'Previous summary shown below.' : ''}</p>
        </div>
      ) : null}

      {hasContent ? (
        <>
          {data.userWants ? (
            <SummaryField label="What they want" value={data.userWants} />
          ) : null}
          {data.tried ? (
            <SummaryField label="What was tried" value={data.tried} />
          ) : null}
          {data.currentStatus ? (
            <SummaryField label="Current status" value={data.currentStatus} />
          ) : null}
          {data.updatedAt ? (
            <p className="text-default-400 text-xs">
              Generated {new Date(data.updatedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {data.model ? ` · ${data.model}` : ''}
            </p>
          ) : null}
        </>
      ) : data.state !== 'error' ? (
        <Button
          size="sm"
          color="primary"
          variant="flat"
          isLoading={isPending}
          onPress={onGenerate}
        >
          Generate summary
        </Button>
      ) : null}
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-default-500 text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      <p className="text-sm">{value}</p>
    </div>
  );
}
