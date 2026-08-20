'use client';

import { Button, Chip, Textarea } from '@heroui/react';
import type { DeliveryStatus, MessageDto } from '@gigachad/shared';
import { useState } from 'react';

import { newClientMessageId, useEmailReply } from '@/lib/inbox';
import { useActiveWorkspace } from '@/lib/session';

// ─── Delivery badge ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Sending…',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  BOUNCED: 'Bounced',
};

const STATUS_COLOR: Record<DeliveryStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'default',
  SENT: 'success',
  DELIVERED: 'success',
  FAILED: 'danger',
  BOUNCED: 'danger',
};

/**
 * Small inline badge that shows the delivery status of an outbound email message.
 * Only rendered for AGENT-sent messages in EMAIL conversations.
 */
export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  return (
    <Chip size="sm" color={STATUS_COLOR[status]} variant="flat" className="text-xs">
      {STATUS_LABEL[status]}
    </Chip>
  );
}

// ─── Email composer ────────────────────────────────────────────────────────────

/**
 * Email reply composer for EMAIL-channel conversations.
 *
 * Unlike the chat Composer, this does not emit typing events — email doesn't
 * have a live presence concept. The reply is sent via
 * POST /api/v1/workspaces/:id/conversations/:conversationId/email-reply, which
 * creates an inbox message, an email_message metadata row, and a BullMQ job
 * that the worker uses to actually deliver the email via Brevo.
 *
 * On failure the draft is preserved so the agent can retry or edit.
 */
export function EmailComposer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent?: (message: MessageDto) => void;
}) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const reply = useEmailReply(workspaceId, conversationId);
  const [text, setText] = useState('');

  const submit = () => {
    const bodyText = text.trim();
    if (!bodyText || reply.isPending) return;

    reply.mutate(
      { bodyText, clientMessageId: newClientMessageId() },
      {
        onSuccess: (message) => {
          setText('');
          reply.reset();
          onSent?.(message);
        },
      },
    );
  };

  return (
    <div className="border-divider flex flex-col gap-2 border-t p-3">
      {reply.isError ? (
        <p className="text-danger text-xs" role="alert">
          Failed to send. Your draft is preserved — edit and try again.
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Email reply"
          placeholder="Write an email reply…"
          minRows={2}
          maxRows={8}
          value={text}
          onValueChange={setText}
          onKeyDown={(e) => {
            // Shift+Enter submits; Enter alone inserts a newline (email convention).
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          isDisabled={reply.isPending}
        />
        <Button
          color="primary"
          isLoading={reply.isPending}
          onPress={submit}
          isDisabled={!text.trim() || reply.isPending}
        >
          Send email
        </Button>
      </div>

      <p className="text-default-400 text-xs">Press Shift+Enter to send</p>
    </div>
  );
}
