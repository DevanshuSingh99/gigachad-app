'use client';

import { Avatar, Listbox, ListboxItem, ScrollShadow, Select, SelectItem, Skeleton, Tabs, Tab } from '@heroui/react';
import type { ConversationDto } from '@gigachad/shared';

import { ChannelChip, StatusChip } from './StatusChip';
import type { ConversationFilters } from '@/lib/inbox';
import { useConversations } from '@/lib/inbox';
import { useActiveWorkspace, useMembers } from '@/lib/session';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ConversationList({
  filters,
  onFiltersChange,
  selectedId,
  onSelect,
}: {
  filters: ConversationFilters;
  onFiltersChange: (next: ConversationFilters) => void;
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
}) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const conversations = useConversations(workspaceId, filters);
  const members = useMembers(workspaceId);

  const rows = conversations.data?.items ?? [];

  return (
    <div className="border-divider flex h-full flex-col border-r">
      <div className="border-divider flex flex-col gap-2 border-b p-3">
        <Tabs
          size="sm"
          aria-label="Status"
          selectedKey={filters.status ?? 'OPEN'}
          onSelectionChange={(key) =>
            onFiltersChange({ ...filters, status: key === 'ALL' ? undefined : (key as ConversationFilters['status']) })
          }
        >
          <Tab key="OPEN" title="Open" />
          <Tab key="SNOOZED" title="Snoozed" />
          <Tab key="RESOLVED" title="Resolved" />
          <Tab key="ALL" title="All" />
        </Tabs>

        {/* Filters collapse into dropdowns rather than inline controls below md
            (docs/15-frontend-and-widget.md). Two Selects at this width already
            behave that way without extra breakpoint logic. */}
        <div className="flex gap-2">
          <Select
            aria-label="Channel"
            size="sm"
            className="flex-1"
            placeholder="All channels"
            selectedKeys={filters.channel ? [filters.channel] : []}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                channel: (e.target.value || undefined) as ConversationFilters['channel'],
              })
            }
          >
            <SelectItem key="CHAT">Chat</SelectItem>
            <SelectItem key="EMAIL">Email</SelectItem>
          </Select>
          <Select
            aria-label="Assignee"
            size="sm"
            className="flex-1"
            placeholder="Anyone"
            selectedKeys={filters.assigneeId ? [filters.assigneeId] : []}
            onChange={(e) =>
              onFiltersChange({ ...filters, assigneeId: e.target.value || undefined })
            }
          >
            <SelectItem key="unassigned">Unassigned</SelectItem>
            <>
              {(members.data ?? []).map((m) => (
                <SelectItem key={m.userId}>{m.name}</SelectItem>
              ))}
            </>
          </Select>
        </div>
      </div>

      <ScrollShadow className="min-h-0 flex-1">
        {conversations.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-large" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-default-500 p-4 text-sm">
            No conversations match these filters.
          </p>
        ) : (
          <Listbox
            aria-label="Conversations"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={selectedId ? [selectedId] : []}
            onSelectionChange={(keys) => {
              if (keys === 'all') return;
              const [key] = keys;
              if (typeof key === 'string') onSelect(key);
            }}
          >
            {rows.map((c: ConversationDto) => (
              <ListboxItem
                key={c.id}
                textValue={c.contact.name ?? c.contact.email ?? 'Conversation'}
                className="h-auto py-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    size="sm"
                    name={c.contact.name ?? c.contact.email ?? '?'}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.contact.name ?? c.contact.email ?? 'Unknown contact'}
                      </span>
                      <span className="text-default-400 shrink-0 text-xs">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <p className="text-default-500 truncate text-xs">
                      {c.subject ?? 'No subject'}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <ChannelChip channel={c.channel} />
                      <StatusChip status={c.status} />
                      {c.assignee ? (
                        <span className="text-default-400 truncate text-xs">→ {c.assignee.name}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </ListboxItem>
            ))}
          </Listbox>
        )}
      </ScrollShadow>
    </div>
  );
}
