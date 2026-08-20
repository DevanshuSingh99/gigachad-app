'use client';

import {
  Avatar,
  Button,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  ScrollShadow,
  Select,
  SelectItem,
  Skeleton,
} from '@heroui/react';
import type { MessageDto, PresenceUpdatePayload, TypingPayload } from '@gigachad/shared';
import { useEffect, useState } from 'react';

import { Composer } from './Composer';
import { ChannelChip, StatusChip } from './StatusChip';
import { useConversation, useMessages, usePatchConversation } from '@/lib/inbox';
import { useActiveWorkspace, useMembers, useMe } from '@/lib/session';
import { getSocket } from '@/lib/socket';

/**
 * Joins the conversation's socket room and tracks the ephemeral state that only
 * makes sense live: who is typing, who is online. Neither goes through TanStack
 * Query — they are not data worth caching or refetching, just a transient
 * reflection of the room's current activity (docs/17-caching.md's reasoning for
 * invalidation-only sockets does not apply to state that has no REST
 * counterpart to invalidate).
 */
function useConversationRoom(workspaceId: string | undefined, conversationId: string) {
  const [typing, setTyping] = useState(false);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    const socket = getSocket(workspaceId);

    setTyping(false);
    setOnline(false);

    // lastSequence: 0 — this is a fresh subscribe, not a reconnect resuming a
    // known position. The initial page of messages already came from the
    // regular HTTP fetch (useMessages); conversation:sync here exists mainly to
    // authorize the room join. A real reconnect-resume path arrives with
    // Phase D's offline-queue work on the widget side.
    socket.emit('conversation:subscribe', { conversationId, lastSequence: 0 });

    const onTypingStart = (p: TypingPayload) => {
      if (p.conversationId === conversationId && p.participantType === 'CUSTOMER') setTyping(true);
    };
    const onTypingStop = (p: TypingPayload) => {
      if (p.conversationId === conversationId && p.participantType === 'CUSTOMER') setTyping(false);
    };
    const onPresence = (p: PresenceUpdatePayload) => {
      if (p.conversationId === conversationId && p.participantType === 'CUSTOMER') {
        setOnline(p.status === 'ONLINE');
      }
    };

    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    socket.on('presence:update', onPresence);

    return () => {
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
      socket.off('presence:update', onPresence);
    };
  }, [workspaceId, conversationId]);

  return { customerTyping: typing, customerOnline: online };
}

const SNOOZE_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '3 hours', hours: 3 },
  { label: 'Tomorrow', hours: 24 },
  { label: '1 week', hours: 24 * 7 },
] as const;

function MessageBubble({ message, isOwn }: { message: MessageDto; isOwn: boolean }) {
  const fromCustomer = message.senderType === 'CUSTOMER';
  return (
    <div className={`flex gap-2 ${fromCustomer ? '' : 'flex-row-reverse'}`}>
      <Avatar size="sm" name={fromCustomer ? 'C' : (message.senderName ?? 'A')} className="mt-1 shrink-0" />
      <div className={`flex max-w-[75%] flex-col gap-1 ${fromCustomer ? 'items-start' : 'items-end'}`}>
        <div
          className={`rounded-large px-3 py-2 text-sm whitespace-pre-wrap ${
            fromCustomer ? 'bg-content2 text-foreground' : 'bg-primary text-primary-foreground'
          }`}
        >
          {message.bodyText}
        </div>
        <span className="text-default-400 text-xs">
          {!fromCustomer && message.senderName ? `${message.senderName} · ` : ''}
          {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {isOwn ? ' · you' : ''}
        </span>
      </div>
    </div>
  );
}

export function ConversationDetail({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack?: () => void;
}) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const me = useMe();
  const conversation = useConversation(workspaceId, conversationId);
  const messages = useMessages(workspaceId, conversationId);
  const members = useMembers(workspaceId);
  const patch = usePatchConversation(workspaceId, conversationId);
  const { customerTyping, customerOnline } = useConversationRoom(workspaceId, conversationId);

  // Advances the read position once the messages a member is looking at are
  // actually loaded — a lower value is ignored server-side, so this is safe to
  // fire on every render where the count moved forward, not just the first.
  useEffect(() => {
    if (!workspaceId || !conversation.data) return;
    const target = conversation.data.messageCount;
    if (target <= conversation.data.agentLastReadSequence) return;
    getSocket(workspaceId).emit('message:read', { conversationId, lastReadSequence: target });
  }, [workspaceId, conversationId, conversation.data]);

  if (conversation.isPending) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-8 w-1/2 rounded-large" />
        <Skeleton className="h-24 w-full rounded-large" />
      </div>
    );
  }

  if (!conversation.data) {
    return <p className="text-default-500 p-4 text-sm">This conversation could not be loaded.</p>;
  }

  const c = conversation.data;
  const rows = messages.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-divider flex flex-wrap items-center gap-2 border-b p-3">
        {onBack ? (
          <Button isIconOnly size="sm" variant="light" onPress={onBack} aria-label="Back to list">
            ←
          </Button>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.contact.name ?? c.contact.email ?? 'Unknown contact'}</p>
          <div className="flex items-center gap-1">
            <p className="text-default-400 truncate text-xs">{c.contact.email}</p>
            {/* Presence never influences authorization and is best-effort
                (docs/06-realtime.md) — a small dot plus text, never color alone. */}
            <Chip size="sm" variant="dot" color={customerOnline ? 'success' : 'default'} className="border-none px-0">
              {customerOnline ? 'online' : 'offline'}
            </Chip>
          </div>
        </div>

        <ChannelChip channel={c.channel} />
        <StatusChip status={c.status} />

        <Select
          aria-label="Assignee"
          size="sm"
          className="w-36"
          placeholder="Unassigned"
          selectedKeys={c.assigneeId ? [c.assigneeId] : []}
          onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}
        >
          {(members.data ?? []).map((m) => (
            <SelectItem key={m.userId}>{m.name}</SelectItem>
          ))}
        </Select>

        <Dropdown>
          <DropdownTrigger>
            <Button size="sm" variant="flat" isDisabled={c.status === 'SNOOZED'}>
              Snooze
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label="Snooze duration"
            onAction={(key) => {
              const hours = SNOOZE_OPTIONS.find((o) => o.label === key)?.hours;
              if (!hours) return;
              patch.mutate({
                status: 'SNOOZED',
                snoozedUntil: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
              });
            }}
          >
            {SNOOZE_OPTIONS.map((o) => (
              <DropdownItem key={o.label}>{o.label}</DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>

        {c.status === 'RESOLVED' ? (
          <Button size="sm" variant="flat" onPress={() => patch.mutate({ status: 'OPEN' })}>
            Reopen
          </Button>
        ) : (
          <Button size="sm" color="success" variant="flat" onPress={() => patch.mutate({ status: 'RESOLVED' })}>
            Resolve
          </Button>
        )}
      </header>

      {/* aria-live polite: incoming messages are announced without stealing focus
          (docs/15-frontend-and-widget.md accessibility rules). */}
      {/* min-h-0: a flex item defaults to min-height:auto, which lets it grow to
          fit its content instead of being capped by the flex parent — flex-1 alone
          does not create a scroll boundary, min-h-0 is what actually caps it. */}
      <ScrollShadow className="min-h-0 flex-1 p-4" aria-live="polite">
        {messages.isPending ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-2/3 rounded-large" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-default-500 text-sm">No messages yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                isOwn={m.senderType === 'AGENT' && m.senderUserId === me.data?.user.id}
              />
            ))}
          </div>
        )}
      </ScrollShadow>

      {customerTyping ? (
        <p className="text-default-400 px-4 pb-1 text-xs" aria-live="polite">
          {c.contact.name ?? 'Customer'} is typing…
        </p>
      ) : null}

      <Composer conversationId={conversationId} />
    </div>
  );
}
