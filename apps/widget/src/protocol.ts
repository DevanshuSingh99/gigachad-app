/**
 * The loader↔panel postMessage protocol (docs/15-frontend-and-widget.md).
 *
 * Deliberately not in packages/shared: that package is the API↔dashboard
 * contract, validated with Zod because it crosses a server trust boundary. This
 * protocol crosses an iframe boundary between two halves of the SAME widget
 * bundle, which only ever exchange messages with each other — the security
 * property that matters here is checking `event.origin`, not schema validation.
 */

export const WIDGET_NAMESPACE = 'gigachad-widget';

/**
 * `session`/`sessionError` are not in docs/15-frontend-and-widget.md's literal
 * message table — they exist because of a structural fact the docs table
 * doesn't spell out: the PANEL runs same-origin to our own app (it is served
 * from the same bundle as the loader), so any fetch call it makes carries OUR
 * app's Origin header, never the host page's. Only the loader genuinely
 * executes inside the host page's origin. So the loader — not the panel —
 * performs the `POST /widget/session` call that the origin allowlist check
 * actually depends on, and relays the result here instead of the panel doing
 * its own fetch. `session` is `null` with `sessionError` set when that call is
 * rejected (e.g. `WIDGET_ORIGIN_NOT_ALLOWED`).
 */
export interface InitMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'init';
  widgetKey: string;
  hostPageUrl: string;
  locale: string;
  apiUrl: string;
  wsUrl: string;
  session: WidgetSessionResult | null;
  sessionError?: string;
}

export interface WidgetSessionResult {
  token: string;
  contact: { id: string; name: string | null };
  conversations: Array<{
    id: string;
    status: string;
    subject: string | null;
    lastMessageAt: string;
    customerLastReadSequence: number;
  }>;
}

export interface ReadyMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'ready';
  /** Read from the panel's own localStorage before this is sent — see InitMessage. */
  visitorToken?: string;
}

export interface ResizeMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'resize';
  height: number;
}

export interface UnreadMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'unread';
  count: number;
}

export interface OpenMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'open';
}

export interface CloseMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'close';
}

/**
 * Not in docs/15-frontend-and-widget.md's table verbatim, but required by its
 * own accessibility rule ("Escape closes"): Escape pressed while focus is
 * inside the panel fires in the IFRAME's document, never the parent's, so the
 * loader's own Escape listener cannot see it. The panel asks the loader to
 * close on its behalf instead of closing itself, since the loader owns the
 * iframe's visibility and the launcher's focus return.
 */
export interface CloseRequestMessage {
  ns: typeof WIDGET_NAMESPACE;
  type: 'closeRequest';
}

export type LoaderToPanelMessage = InitMessage | OpenMessage | CloseMessage;
export type PanelToLoaderMessage = ReadyMessage | ResizeMessage | UnreadMessage | CloseRequestMessage;

export function isWidgetMessage(data: unknown): data is { ns: string; type: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { ns?: unknown }).ns === WIDGET_NAMESPACE &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}
