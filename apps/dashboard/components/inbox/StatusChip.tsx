import { Chip } from '@heroui/react';
import type { ConversationStatus } from '@gigachad/shared';

/**
 * Status colors are semantic and fixed, reused everywhere they appear
 * (docs/15-frontend-and-widget.md). Text always accompanies color — status is
 * never conveyed by color alone.
 */
const STATUS_META: Record<ConversationStatus, { label: string; color: 'primary' | 'warning' | 'success' }> = {
  OPEN: { label: 'Open', color: 'primary' },
  SNOOZED: { label: 'Snoozed', color: 'warning' },
  RESOLVED: { label: 'Resolved', color: 'success' },
};

export function StatusChip({ status }: { status: ConversationStatus }) {
  const meta = STATUS_META[status];
  return (
    <Chip size="sm" variant="flat" color={meta.color}>
      {meta.label}
    </Chip>
  );
}

export function ChannelChip({ channel }: { channel: 'CHAT' | 'EMAIL' }) {
  return (
    <Chip size="sm" variant="dot" color={channel === 'CHAT' ? 'secondary' : 'default'}>
      {channel === 'CHAT' ? 'Chat' : 'Email'}
    </Chip>
  );
}
