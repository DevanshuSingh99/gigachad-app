'use client';

import { Button, Textarea } from '@heroui/react';
import { useState } from 'react';

import { newClientMessageId, useSendMessage } from '@/lib/inbox';
import { useActiveWorkspace } from '@/lib/session';

/**
 * Plain textarea, not a rich-text editor — the conversation view gets no WYSIWYG
 * toolbar in this design (docs/15-frontend-and-widget.md maps only Textarea,
 * Button, Chip, Tooltip, Divider to this screen). bodyHtml is sanitized
 * server-side regardless; this composer only ever sends bodyText.
 */
export function Composer({ conversationId }: { conversationId: string }) {
  const { workspace } = useActiveWorkspace();
  const send = useSendMessage(workspace?.workspaceId, conversationId);
  const [text, setText] = useState('');

  const submit = () => {
    const bodyText = text.trim();
    if (!bodyText) return;
    // Cleared immediately rather than waiting on the response — the composer
    // never blocks on the network, even without full optimistic rendering yet.
    setText('');
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
        onValueChange={setText}
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
