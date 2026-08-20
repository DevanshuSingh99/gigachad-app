/**
 * Everything persisted lives inside the iframe's OWN origin — unreadable by the
 * host page and unaffected by the host clearing its own storage
 * (docs/15-frontend-and-widget.md). Keyed by widgetKey so one browser visiting
 * two different workspaces' widgets never mixes their sessions.
 */

export interface Draft {
  clientMessageId: string;
  bodyText: string;
  status: 'pending' | 'failed';
  createdAt: number;
}

function key(widgetKey: string, name: string): string {
  return `gc_widget_${name}_${widgetKey}`;
}

export function loadToken(widgetKey: string): string | null {
  return localStorage.getItem(key(widgetKey, 'token'));
}

export function saveToken(widgetKey: string, token: string): void {
  localStorage.setItem(key(widgetKey, 'token'), token);
}

export function loadOutbox(widgetKey: string): Draft[] {
  try {
    const raw = localStorage.getItem(key(widgetKey, 'outbox'));
    return raw ? (JSON.parse(raw) as Draft[]) : [];
  } catch {
    return [];
  }
}

export function saveOutbox(widgetKey: string, drafts: Draft[]): void {
  localStorage.setItem(key(widgetKey, 'outbox'), JSON.stringify(drafts));
}
