'use client';

import { Button, Textarea } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';

import { REALTIME } from '@gigachad/shared';
import { newClientMessageId, useSendMessage } from '@/lib/inbox';
import { useActiveWorkspace } from '@/lib/session';
import { getSocket } from '@/lib/socket';
import { useCannedResponses } from '@/lib/canned-responses';

/**
 * Plain textarea, not a rich-text editor — the conversation view gets no WYSIWYG
 * toolbar in this design (docs/15-frontend-and-widget.md maps only Textarea,
 * Button, Chip, Tooltip, Divider to this screen). bodyHtml is sanitized
 * server-side regardless; this composer only ever sends bodyText.
 *
 * Canned responses: typing "/" (or "/query") shows a dropdown of matching saved
 * replies. Arrow keys navigate, Enter inserts, Esc dismisses.
 */
export function Composer({ conversationId }: { conversationId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const send = useSendMessage(workspaceId, conversationId);
  const [text, setText] = useState('');

  // ─── Canned-response picker ───────────────────────────────────────────────
  // The picker is shown when the composer text starts with "/".
  // The part after "/" is the search term fed to the API.
  const isCannedTrigger = text.startsWith('/');
  const cannedSearch = isCannedTrigger ? text.slice(1) : '';

  const cannedList = useCannedResponses(
    workspaceId,
    isCannedTrigger ? (cannedSearch ? { search: cannedSearch } : {}) : {},
  );
  const suggestions = cannedList.data ?? [];
  const showPicker = isCannedTrigger && suggestions.length > 0;

  const [pickerIndex, setPickerIndex] = useState(0);
  // Reset selection index whenever suggestions change.
  useEffect(() => { setPickerIndex(0); }, [suggestions.length]);

  const insertCannedResponse = (content: string) => {
    setText(content);
  };

  // ─── Typing indicators ────────────────────────────────────────────────────

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
    setText('');
    clearTimeout(stopTimerRef.current);
    clearInterval(refreshTimerRef.current);
    if (isTypingRef.current && workspaceId) {
      isTypingRef.current = false;
      getSocket(workspaceId).emit('typing:stop', { conversationId });
    }
    send.mutate({ bodyText, clientMessageId: newClientMessageId() });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (showPicker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPickerIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPickerIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        insertCannedResponse(suggestions[pickerIndex]?.content ?? '');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setText('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-divider flex flex-col gap-0 border-t">
      {/* Canned-response picker — floats above the composer, anchored to its top edge */}
      {showPicker ? (
        <div
          className="border-divider bg-content1 max-h-48 overflow-y-auto border-b"
          role="listbox"
          aria-label="Canned responses"
        >
          {suggestions.map((r, i) => (
            <button
              key={r.id}
              role="option"
              aria-selected={i === pickerIndex}
              className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
                i === pickerIndex ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-default-100'
              }`}
              onMouseEnter={() => setPickerIndex(i)}
              onMouseDown={(e) => {
                // mousedown fires before blur; prevent blur from closing the
                // textarea before the click completes.
                e.preventDefault();
                insertCannedResponse(r.content);
              }}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {r.name}
                {r.shortcut ? (
                  <code className="bg-default-100 text-default-500 rounded px-1 text-xs">
                    /{r.shortcut}
                  </code>
                ) : null}
              </span>
              <span className="text-default-400 line-clamp-1">{r.content}</span>
            </button>
          ))}
          <p className="text-default-400 border-divider border-t px-3 py-1.5 text-xs">
            ↑↓ navigate · Enter insert · Esc dismiss
          </p>
        </div>
      ) : null}

      <div className="flex items-end gap-2 p-3">
        <Textarea
          aria-label="Reply"
          placeholder={isCannedTrigger ? 'Type to filter canned responses…' : 'Write a reply… (type / for saved replies)'}
          minRows={1}
          maxRows={6}
          value={text}
          onValueChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <Button color="primary" isLoading={send.isPending} onPress={submit} isDisabled={!text.trim() || isCannedTrigger}>
          Send
        </Button>
      </div>
    </div>
  );
}
