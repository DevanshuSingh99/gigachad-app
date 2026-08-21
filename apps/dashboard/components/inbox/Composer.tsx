'use client';

import { Button, Textarea } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';

import { REALTIME } from '@gigachad/shared';
import { newClientMessageId, useSendMessage } from '@/lib/inbox';
import { useActiveWorkspace } from '@/lib/session';
import { getSocket } from '@/lib/socket';

/**
 * Plain textarea, not a rich-text editor — the conversation view gets no WYSIWYG
 * toolbar in this design (docs/15-frontend-and-widget.md maps only Textarea,
 * Button, Chip, Tooltip, Divider to this screen). bodyHtml is sanitized
 * server-side regardless; this composer only ever sends bodyText.
 */
export function Composer({ conversationId }: { conversationId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const send = useSendMessage(workspaceId, conversationId);
  const [text, setText] = useState('');

  // Client-side debounce, not per-keystroke emission: typing:start fires once
  // per burst, typing:stop fires ~2s after the last keystroke or immediately on
  // send. The TTL in presence.ts is the safety net if stop is ever missed — but
  // a continuous burst longer than that TTL still needs a periodic re-emit
  // (refreshTimerRef below), or the receiver's indicator silently expires
  // mid-burst even though this side never stopped typing.
  const isTypingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(stopTimerRef.current);
      clearInterval(refreshTimerRef.current);
      if (isTypingRef.current && workspaceId) {
        getSocket(workspaceId).emit('typing:stop', { conversationId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const handleChange = (value: string) => {
    setText(value);
    if (!workspaceId) return;
    const socket = getSocket(workspaceId);

    if (value.trim() && !isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing:start', { conversationId });
      refreshTimerRef.current = setInterval(() => {
        socket.emit('typing:start', { conversationId });
      }, Math.floor(REALTIME.typingTtlMs * 0.6));
    }

    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      clearInterval(refreshTimerRef.current);
      socket.emit('typing:stop', { conversationId });
    }, 2_000);
  };

  const submit = () => {
    const bodyText = text.trim();
    if (!bodyText) return;
    // Cleared immediately rather than waiting on the response — the composer
    // never blocks on the network, even without full optimistic rendering yet.
    setText('');
    clearTimeout(stopTimerRef.current);
    clearInterval(refreshTimerRef.current);
    if (isTypingRef.current && workspaceId) {
      isTypingRef.current = false;
      getSocket(workspaceId).emit('typing:stop', { conversationId });
    }
    send.mutate({ bodyText, clientMessageId: newClientMessageId() });
  };

  return (
    <div className="border-divider flex items-end gap-2 border-t p-3">
      <Textarea
        aria-label="Reply"
        placeholder="Write a reply…"
        minRows={1}
        maxRows={6}
        value={text}
        onValueChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button color="primary" isLoading={send.isPending} onPress={submit} isDisabled={!text.trim()}>
        Send
      </Button>
    </div>
  );
}
