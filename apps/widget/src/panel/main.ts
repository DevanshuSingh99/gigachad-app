import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ConversationSyncPayload,
  MessageNewPayload,
  MessageReadPayload,
  PresenceUpdatePayload,
  ServerToClientEvents,
  SuggestionDto,
  TypingPayload,
  WidgetMessageDto,
} from '@gigachad/shared';
import { REALTIME } from '@gigachad/shared';

import { WIDGET_NAMESPACE, isWidgetMessage, type InitMessage } from '../protocol';
import { widgetFetch } from './api';
import { loadOutbox, loadToken, saveOutbox, saveToken, type Draft } from './storage';

/**
 * The widget panel. Loaded once, lazily, the first time a customer opens the
 * launcher — nothing here runs, and none of this bundle's bytes are even
 * fetched, until then (docs/15-frontend-and-widget.md).
 */

// Baked in at build time by esbuild's `define` (apps/widget/scripts/build.mjs),
// the same way loader.ts gets them — NOT taken from the loader's `init`
// postMessage. The `init` payload crosses an origin boundary that legitimately
// varies per host site, so it cannot be authenticated; treating apiUrl/wsUrl as
// data from that channel would let any script on the host page redirect this
// panel's widget token to an attacker-controlled endpoint.
declare const WIDGET_API_URL: string;
declare const WIDGET_WS_URL: string;

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface DisplayMessage {
  id: string;
  senderType: WidgetMessageDto['senderType'];
  bodyText: string;
  sequence: number;
  createdAt: string;
  status?: 'pending' | 'failed';
}

interface State {
  config: InitMessage | null;
  contactName: string | null;
  conversationId: string | null;
  messages: DisplayMessage[];
  outbox: Draft[];
  connection: 'connecting' | 'online' | 'offline';
  sessionError: string | null;
  agentTyping: boolean;
  agentOnline: boolean;
  agentLastReadSequence: number;
  isOpen: boolean;
}

const state: State = {
  config: null,
  contactName: null,
  conversationId: null,
  messages: [],
  outbox: [],
  connection: 'connecting',
  sessionError: null,
  agentTyping: false,
  agentOnline: false,
  agentLastReadSequence: 0,
  isOpen: true,
};

let socket: AppSocket | null = null;
let composerEl: HTMLTextAreaElement | null = null;

// ─── KB suggestions ─────────────────────────────────────────────────────────
// Rendered imperatively into a dedicated element rather than through the full
// `render()` cycle below — `render()` rebuilds the composer's <textarea> from
// scratch on every call, which would wipe out whatever the customer is mid-
// typing. Debounced well under the `kbSuggestions` rate limit (60/min per
// widget session, packages/shared/src/limits.ts): a debounce only fires once
// typing pauses, so even fast continuous typing produces far fewer than one
// request per keystroke.
const SUGGESTIONS_DEBOUNCE_MS = 250;
let suggestionsListEl: HTMLUListElement | null = null;
let suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let suggestRequestSeq = 0;

// Typing is fire-and-forget: start per burst, stop ~2s after the last
// keystroke (or immediately on send / empty). Matches the dashboard composer.
// The server's typing key TTL (REALTIME.typingTtlMs) is only refreshed when a
// 'typing:start' actually arrives, so a single start at the top of a long
// continuous burst is not enough — without a periodic re-emit, the receiver's
// indicator would silently expire and disappear mid-burst even though this
// side never stopped typing.
let customerTyping = false;
let customerTypingStopTimer: ReturnType<typeof setTimeout> | undefined;
let customerTypingRefreshTimer: ReturnType<typeof setInterval> | undefined;
let agentTypingExpiry: ReturnType<typeof setTimeout> | undefined;
let agentPresenceExpiry: ReturnType<typeof setTimeout> | undefined;

function apiConfig() {
  if (!state.config) throw new Error('panel used before init');
  return { apiUrl: WIDGET_API_URL, getToken: () => loadToken(state.config!.widgetKey) };
}

function postToLoader(message: { type: string } & Record<string, unknown>): void {
  window.parent.postMessage({ ns: WIDGET_NAMESPACE, ...message }, '*');
  // '*' here is safe specifically because nothing sent to the loader is
  // sensitive (a resize height, an unread count, a ready/close signal) — the
  // customer's own message content never crosses this direction. Messages
  // RECEIVED from the loader are still checked against the expected parent
  // origin before being trusted; see the message listener below.
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Receives the session the LOADER already created (see protocol.ts's
 * InitMessage for why the fetch has to happen there, not here) and finishes
 * bringing the panel up: persist the token, load history for the most recent
 * conversation if one exists, then connect the socket.
 */
async function bootstrap(config: InitMessage): Promise<void> {
  state.config = config;

  if (!config.session) {
    state.connection = 'offline';
    state.sessionError = config.sessionError ?? 'Could not start a chat session.';
    render();
    return;
  }

  const session = config.session;
  saveToken(config.widgetKey, session.token);
  state.contactName = session.contact.name;
  state.outbox = loadOutbox(config.widgetKey);

  const latest = session.conversations[0];
  if (latest) {
    state.conversationId = latest.id;
    state.agentLastReadSequence = latest.agentLastReadSequence;
    try {
      const page = await widgetFetch<{ items: WidgetMessageDto[] }>(
        apiConfig(),
        `/api/v1/widget/conversations/${latest.id}/messages?limit=100`,
      );
      state.messages = page.items.map(toDisplayMessage);
    } catch {
      // History failed to load; the conversation still works going forward.
    }
  }

  connectSocket();
  render();
}

function toDisplayMessage(m: WidgetMessageDto | MessageNewPayload): DisplayMessage {
  return {
    id: 'id' in m ? m.id : m.messageId,
    senderType: m.senderType,
    bodyText: m.bodyText,
    sequence: m.sequence,
    createdAt: m.createdAt,
  };
}

/**
 * HTTP catch-up when `conversation:sync` is truncated past REALTIME.syncMessageCap.
 * Walks cursor pages so a long absence is not silently missing the middle.
 */
async function refetchHistory(conversationId: string): Promise<void> {
  try {
    const collected: WidgetMessageDto[] = [];
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams({ limit: '100' });
      if (cursor) qs.set('cursor', cursor);
      const page = await widgetFetch<{ items: WidgetMessageDto[]; nextCursor: string | null }>(
        apiConfig(),
        `/api/v1/widget/conversations/${conversationId}/messages?${qs.toString()}`,
      );
      collected.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    const byId = new Map(state.messages.map((m) => [m.id, m]));
    for (const m of collected) byId.set(m.id, toDisplayMessage(m));
    state.messages = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
    render();
    markRead();
  } catch {
    // Keep whatever we already have; the next reconnect will try again.
  }
}

// ─── Socket ─────────────────────────────────────────────────────────────────

function connectSocket(): void {
  if (!state.config) return;
  const token = loadToken(state.config.widgetKey);
  if (!token) return;

  socket = io(WIDGET_WS_URL, {
    auth: {
      widgetToken: token,
      // The socket connection, like this panel's own fetches, originates from
      // OUR app's origin, not the host page's — the same structural fact
      // documented on protocol.ts's InitMessage. There is no way to make the
      // WebSocket handshake itself carry the host page's real Origin header
      // (unlike the REST session call, a socket can't be relayed through the
      // loader without bundling socket.io-client into the loader, which would
      // blow its 15KB budget). So the server accepts this self-reported value
      // for the widget socket path specifically — realtime/auth.ts documents
      // why that is an acceptable, narrower trust boundary than the dashboard
      // socket's real browser-enforced Origin check: the short-lived,
      // contact-scoped bearer token is what actually protects this connection.
      origin: new URL(state.config.hostPageUrl).origin,
    },
    reconnectionDelay: 500,
    reconnectionDelayMax: 8_000,
  });

  socket.on('connect', () => {
    state.connection = 'online';
    if (state.conversationId) subscribeToConversation();
    void flushOutbox();
    render();
  });

  socket.on('disconnect', () => {
    state.connection = 'offline';
    render();
  });

  socket.on('connect_error', () => {
    state.connection = 'offline';
    render();
  });

  socket.on('message:new', (payload: MessageNewPayload) => {
    if (payload.conversationId !== state.conversationId) return;
    if (state.messages.some((m) => m.id === payload.messageId)) return;
    insertMessageInOrder(toDisplayMessage(payload));
    render();
    markRead();
  });

  socket.on('conversation:sync', (p: ConversationSyncPayload) => {
    if (p.conversationId !== state.conversationId) return;
    if (p.truncated) {
      void refetchHistory(p.conversationId);
      return;
    }
    let added = false;
    for (const m of p.messages) {
      if (state.messages.some((x) => x.id === m.messageId)) continue;
      state.messages.push(toDisplayMessage(m));
      added = true;
    }
    if (added) {
      state.messages.sort((a, b) => a.sequence - b.sequence);
      render();
      markRead();
    }
  });

  socket.on('typing:start', (p: TypingPayload) => {
    if (p.conversationId !== state.conversationId || p.participantType !== 'AGENT') return;
    state.agentTyping = true;
    clearTimeout(agentTypingExpiry);
    agentTypingExpiry = setTimeout(() => {
      state.agentTyping = false;
      render();
    }, REALTIME.typingTtlMs + 500);
    render();
  });
  socket.on('typing:stop', (p: TypingPayload) => {
    if (p.conversationId !== state.conversationId || p.participantType !== 'AGENT') return;
    clearTimeout(agentTypingExpiry);
    state.agentTyping = false;
    render();
  });
  socket.on('message:read', (p: MessageReadPayload) => {
    if (p.conversationId !== state.conversationId || p.readerType !== 'AGENT') return;
    if (p.lastReadSequence > state.agentLastReadSequence) {
      state.agentLastReadSequence = p.lastReadSequence;
      render();
    }
  });
  socket.on('presence:update', (p: PresenceUpdatePayload) => {
    if (p.conversationId !== state.conversationId || p.participantType !== 'AGENT') return;
    state.agentOnline = p.status === 'ONLINE';
    clearTimeout(agentPresenceExpiry);
    if (p.status === 'ONLINE') {
      agentPresenceExpiry = setTimeout(() => {
        state.agentOnline = false;
        render();
      }, REALTIME.presenceTtlMs + 5_000);
    }
    render();
  });
}

function subscribeToConversation(): void {
  if (!socket?.connected || !state.conversationId) return;
  const lastSequence = state.messages.at(-1)?.sequence ?? 0;
  socket.emit('conversation:subscribe', { conversationId: state.conversationId, lastSequence }, (ack) => {
    if (ack.ok) markRead();
  });
}

function markRead(): void {
  if (!socket?.connected || !state.conversationId || !state.isOpen) return;
  const lastReadSequence = state.messages.at(-1)?.sequence ?? 0;
  if (lastReadSequence > 0) {
    socket.emit('message:read', { conversationId: state.conversationId, lastReadSequence });
  }
}

function stopCustomerTyping(): void {
  clearTimeout(customerTypingStopTimer);
  clearInterval(customerTypingRefreshTimer);
  if (!customerTyping || !state.conversationId) return;
  customerTyping = false;
  socket?.emit('typing:stop', { conversationId: state.conversationId });
}

function onComposerTyping(value: string): void {
  if (!socket?.connected || !state.conversationId) return;
  if (!value.trim()) {
    stopCustomerTyping();
    return;
  }
  if (!customerTyping) {
    customerTyping = true;
    socket.emit('typing:start', { conversationId: state.conversationId });
    // Re-send well inside the server's TTL so a continuous burst never lets
    // the receiver's indicator expire before this side actually stops.
    customerTypingRefreshTimer = setInterval(() => {
      if (state.conversationId) socket?.emit('typing:start', { conversationId: state.conversationId });
    }, Math.floor(REALTIME.typingTtlMs * 0.6));
  }
  clearTimeout(customerTypingStopTimer);
  customerTypingStopTimer = setTimeout(() => stopCustomerTyping(), 2_000);
}

// ─── Sending, with the offline queue ────────────────────────────────────────

function persistOutbox(): void {
  if (state.config) saveOutbox(state.config.widgetKey, state.outbox);
}

/**
 * Delivers one draft. The same `clientMessageId` is reused across every retry
 * of the SAME draft, which is what makes this exactly-once end to end: if a
 * prior attempt actually persisted before the connection dropped, the server's
 * idempotency check returns that original message instead of creating a
 * second one (docs/06-realtime.md, docs/13-testing-strategy.md test 14).
 */
async function sendDraft(draft: Draft): Promise<void> {
  const api = apiConfig();
  try {
    if (!state.conversationId) {
      // The very first message from this contact — the socket protocol needs a
      // real conversation id, which does not exist yet, so this one send
      // bootstraps it over REST via the "new" sentinel (docs/05-api.md's
      // "creates the conversation on first send", resolved in
      // modules/widget/service.ts).
      const message = await widgetFetch<WidgetMessageDto>(
        api,
        '/api/v1/widget/conversations/new/messages',
        { method: 'POST', body: { bodyText: draft.bodyText, clientMessageId: draft.clientMessageId } },
      );
      state.conversationId = message.conversationId;
      applyDelivered(draft, toDisplayMessage(message));
      socket?.emit('conversation:subscribe', { conversationId: message.conversationId, lastSequence: message.sequence }, (ack) => {
        if (ack.ok) markRead();
      });
    } else if (socket?.connected) {
      const ack = await new Promise<
        { ok: true; data: { messageId: string; sequence: number; createdAt: string } } | { ok: false; message: string }
      >((resolve) => {
        socket!.emit(
          'message:send',
          { conversationId: state.conversationId!, clientMessageId: draft.clientMessageId, bodyText: draft.bodyText },
          resolve as never,
        );
      });
      if (!ack.ok) throw new Error(ack.message);
      applyDelivered(draft, {
        id: ack.data.messageId,
        senderType: 'CUSTOMER',
        bodyText: draft.bodyText,
        sequence: ack.data.sequence,
        createdAt: ack.data.createdAt,
      });
    } else {
      const message = await widgetFetch<WidgetMessageDto>(
        api,
        `/api/v1/widget/conversations/${state.conversationId}/messages`,
        { method: 'POST', body: { bodyText: draft.bodyText, clientMessageId: draft.clientMessageId } },
      );
      applyDelivered(draft, toDisplayMessage(message));
    }
  } catch (err) {
    draft.status = 'failed';
    persistOutbox();
    render();
  }
}

/**
 * Inserts a message keeping `state.messages` sorted by `sequence`. Delivery
 * order isn't guaranteed once the Redis adapter fans events out across
 * multiple API instances (docs/06-realtime.md), so `markRead`/`subscribeToConversation`
 * — which both read `state.messages.at(-1)?.sequence` — need the array to stay
 * sorted rather than just append-ordered.
 */
function insertMessageInOrder(message: DisplayMessage): void {
  const index = state.messages.findIndex((m) => m.sequence > message.sequence);
  if (index === -1) state.messages.push(message);
  else state.messages.splice(index, 0, message);
}

function applyDelivered(draft: Draft, message: DisplayMessage): void {
  state.outbox = state.outbox.filter((d) => d.clientMessageId !== draft.clientMessageId);
  persistOutbox();
  if (!state.messages.some((m) => m.id === message.id)) insertMessageInOrder(message);
  render();
}

async function flushOutbox(): Promise<void> {
  for (const draft of [...state.outbox]) {
    await sendDraft(draft);
  }
}

function submitMessage(text: string): void {
  const bodyText = text.trim();
  if (!bodyText || !state.config) return;
  stopCustomerTyping();
  const draft: Draft = {
    clientMessageId: `cm_${crypto.randomUUID()}`,
    bodyText,
    status: 'pending',
    createdAt: Date.now(),
  };
  state.outbox.push(draft);
  persistOutbox();
  render();
  void sendDraft(draft);
}

// ─── Rendering ──────────────────────────────────────────────────────────────
// Full re-render on every state change rather than a diffing layer — the panel
// is six small components and a handful of messages at a time; the complexity
// a virtual DOM would buy back is not worth the bytes in a 15KB-adjacent bundle.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeader(): HTMLElement {
  const header = el('header', 'flex items-center justify-between border-b border-gray-200 px-4 py-3');
  const title = el('div', 'flex flex-col');
  title.appendChild(el('span', 'font-medium text-gray-900', 'Chat with us'));
  title.appendChild(
    el('span', `text-xs ${state.agentOnline ? 'text-green-600' : 'text-gray-400'}`, state.agentOnline ? 'Online' : 'Offline'),
  );
  header.appendChild(title);
  const closeBtn = el('button', 'text-gray-400 hover:text-gray-600', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.addEventListener('click', () => postToLoader({ type: 'closeRequest' }));
  header.appendChild(closeBtn);
  return header;
}

function renderConnectionBanner(): HTMLElement | null {
  if (state.sessionError) {
    const banner = el('div', 'px-4 py-1.5 text-center text-xs bg-red-50 text-red-700', state.sessionError);
    banner.setAttribute('role', 'alert');
    return banner;
  }
  if (state.connection === 'online') return null;
  const label = state.connection === 'connecting' ? 'Connecting…' : 'Offline — messages will send once reconnected';
  const banner = el(
    'div',
    `px-4 py-1.5 text-center text-xs ${state.connection === 'offline' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-500'}`,
    label,
  );
  banner.setAttribute('role', 'status');
  return banner;
}

function statusLabel(status: Draft['status'] | undefined): string | null {
  if (status === 'pending') return 'Sending…';
  if (status === 'failed') return 'Not delivered — tap to retry';
  return null;
}

function renderMessageList(): HTMLElement {
  const list = el('div', 'flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2');
  list.id = 'gc-messages';
  // Announces new messages without stealing focus (docs/15-frontend-and-widget.md).
  list.setAttribute('aria-live', 'polite');

  if (state.messages.length === 0 && state.outbox.length === 0) {
    list.appendChild(el('p', 'text-sm text-gray-400', 'Send a message to start the conversation.'));
  }

  for (const m of state.messages) {
    const fromCustomer = m.senderType === 'CUSTOMER';
    const row = el('div', `flex ${fromCustomer ? 'justify-end' : 'justify-start'}`);
    const wrap = el('div', `flex max-w-[80%] flex-col gap-0.5 ${fromCustomer ? 'items-end' : 'items-start'}`);
    const bubble = el(
      'div',
      `rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
        fromCustomer ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
      }`,
      m.bodyText,
    );
    wrap.appendChild(bubble);
    if (fromCustomer) {
      const read = m.sequence > 0 && m.sequence <= state.agentLastReadSequence;
      const ticks = el(
        'span',
        `gc-ticks ${read ? 'gc-ticks--read' : 'gc-ticks--sent'}`,
        read ? '✓✓' : '✓',
      );
      ticks.setAttribute('aria-label', read ? 'Read' : 'Sent');
      wrap.appendChild(ticks);
    }
    row.appendChild(wrap);
    list.appendChild(row);
  }

  for (const draft of state.outbox) {
    const row = el('div', 'flex justify-end');
    const wrap = el('div', 'flex flex-col items-end gap-0.5');
    const bubble = el(
      'div',
      `max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap text-white ${
        draft.status === 'failed' ? 'bg-red-400' : 'bg-blue-400'
      }`,
      draft.bodyText,
    );
    wrap.appendChild(bubble);
    const label = statusLabel(draft.status);
    if (label) {
      const statusEl = el('button', 'text-xs text-gray-400', label);
      statusEl.type = 'button';
      if (draft.status === 'failed') {
        statusEl.addEventListener('click', () => void sendDraft(draft));
      }
      wrap.appendChild(statusEl);
    }
    row.appendChild(wrap);
    list.appendChild(row);
  }

  return list;
}

function renderTypingIndicator(): HTMLElement | null {
  if (!state.agentTyping) return null;
  const row = el('div', 'flex justify-start px-4 pb-2');
  const bubble = el('div', 'gc-typing rounded-2xl bg-gray-100 px-3 py-2');
  bubble.setAttribute('aria-label', 'Agent is typing');
  bubble.setAttribute('role', 'status');
  for (let i = 0; i < 3; i++) bubble.appendChild(el('span'));
  row.appendChild(bubble);
  return row;
}

/** Clears any pending debounce and hides the dropdown. */
function clearSuggestions(): void {
  if (suggestDebounceTimer) {
    clearTimeout(suggestDebounceTimer);
    suggestDebounceTimer = null;
  }
  suggestRequestSeq++; // invalidates any in-flight fetch's response
  renderSuggestionsList([]);
}

function renderSuggestionsList(items: SuggestionDto[]): void {
  if (!suggestionsListEl) return;
  suggestionsListEl.innerHTML = '';
  if (items.length === 0) {
    suggestionsListEl.classList.add('hidden');
    return;
  }
  suggestionsListEl.classList.remove('hidden');
  for (const item of items) {
    const li = el('li');
    const button = el(
      'button',
      'gc-suggestion block w-full truncate px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50',
      item.title,
    );
    button.type = 'button';
    button.setAttribute('role', 'option');
    // mousedown (not click), with preventDefault, so the textarea never
    // blurs — clicking a suggestion just closes the dropdown, per the
    // current suggestion feature scope (no inline article reader yet).
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      clearSuggestions();
      composerEl?.focus();
    });
    li.appendChild(button);
    suggestionsListEl.appendChild(li);
  }
}

async function fetchSuggestions(query: string): Promise<void> {
  if (!state.config) return;
  const mySeq = ++suggestRequestSeq;
  try {
    const results = await widgetFetch<SuggestionDto[]>(
      apiConfig(),
      `/api/v1/widget/suggestions?q=${encodeURIComponent(query)}`,
    );
    if (mySeq !== suggestRequestSeq) return; // superseded by a newer keystroke/blur
    renderSuggestionsList(results);
  } catch {
    if (mySeq !== suggestRequestSeq) return;
    renderSuggestionsList([]);
  }
}

function renderComposer(): HTMLElement {
  const outer = el('div', 'relative border-t border-gray-200 p-3');

  const suggestions = document.createElement('ul');
  suggestions.className =
    'gc-suggestions hidden absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg';
  suggestions.setAttribute('role', 'listbox');
  suggestions.setAttribute('aria-label', 'Suggested articles');
  suggestionsListEl = suggestions;

  const wrap = el('div', 'flex items-end gap-2');

  const textarea = document.createElement('textarea');
  textarea.className =
    'flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';
  textarea.rows = 1;
  textarea.placeholder = 'Write a message…';
  textarea.setAttribute('aria-label', 'Message');
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const value = textarea.value;
      textarea.value = '';
      clearSuggestions();
      submitMessage(value);
    }
    if (e.key === 'Escape') postToLoader({ type: 'closeRequest' });
  });
  textarea.addEventListener('input', () => {
    const query = textarea.value.trim();
    onComposerTyping(textarea.value);
    if (suggestDebounceTimer) clearTimeout(suggestDebounceTimer);
    if (!query) {
      clearSuggestions();
      return;
    }
    suggestDebounceTimer = setTimeout(() => void fetchSuggestions(query), SUGGESTIONS_DEBOUNCE_MS);
  });
  textarea.addEventListener('blur', () => {
    // Deferred: a suggestion button's own `mousedown` handler runs first and
    // calls clearSuggestions() itself; this is the fallback for blur caused by
    // anything else (tabbing away, clicking outside the panel).
    setTimeout(clearSuggestions, 150);
  });
  composerEl = textarea;

  const sendBtn = el('button', 'rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700', 'Send');
  sendBtn.type = 'button';
  sendBtn.addEventListener('click', () => {
    const value = textarea.value;
    textarea.value = '';
    clearSuggestions();
    submitMessage(value);
  });

  wrap.appendChild(textarea);
  wrap.appendChild(sendBtn);
  outer.appendChild(suggestions);
  outer.appendChild(wrap);
  return outer;
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  const hadFocus = document.activeElement === composerEl;
  const draft = composerEl
    ? { value: composerEl.value, start: composerEl.selectionStart, end: composerEl.selectionEnd }
    : null;
  const prevList = document.getElementById('gc-messages');
  const scrollTop = prevList?.scrollTop ?? null;
  const nearBottom = prevList ? prevList.scrollHeight - prevList.scrollTop - prevList.clientHeight < 48 : true;

  app.innerHTML = '';
  app.className = 'gc-app flex h-full flex-col bg-white';

  app.appendChild(renderHeader());
  const banner = renderConnectionBanner();
  if (banner) app.appendChild(banner);
  app.appendChild(renderMessageList());
  const typing = renderTypingIndicator();
  if (typing) app.appendChild(typing);
  app.appendChild(renderComposer());

  if (draft && composerEl) {
    composerEl.value = draft.value;
    composerEl.setSelectionRange(draft.start, draft.end);
    if (hadFocus) composerEl.focus();
  }
  const list = document.getElementById('gc-messages');
  if (list) {
    if (nearBottom) list.scrollTop = list.scrollHeight;
    else if (scrollTop != null) list.scrollTop = scrollTop;
  }

  const unread = state.isOpen ? 0 : state.messages.filter((m) => m.senderType === 'AGENT').length;
  postToLoader({ type: 'unread', count: unread });
}

// ─── Wiring to the loader ───────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
  if (!isWidgetMessage(event.data)) return;
  // No origin check here, deliberately: the loader executes inside whichever
  // arbitrary site installed the widget, not inside this panel's own origin —
  // that page's origin is exactly what VARIES per legitimate installation, so
  // there is no fixed value to compare against. (The opposite direction, in
  // loader.ts, DOES check origin strictly, because the panel's origin is fixed
  // — always this same CDN-served bundle.) The namespace check in
  // isWidgetMessage is what filters out unrelated postMessage traffic a host
  // page might otherwise generate. Because this channel can't be authenticated,
  // apiUrl/wsUrl are never read from it — see the WIDGET_API_URL/WIDGET_WS_URL
  // constants above — so the worst a forged `init` message can do is feed this
  // panel a bogus session/hostPageUrl, not redirect its network traffic.
  switch (event.data.type) {
    case 'init':
      void bootstrap(event.data as InitMessage);
      break;
    case 'open':
      state.isOpen = true;
      markRead();
      render();
      composerEl?.focus();
      break;
    case 'close':
      state.isOpen = false;
      break;
  }
});

function boot(): void {
  render();
  postToLoader({ type: 'resize', height: 600 });

  // The widgetKey arrives via the iframe's own URL, not (yet) via postMessage —
  // it has to be available synchronously here so the stored token can be
  // looked up and included in `ready`, before the loader's session-resume
  // fetch runs (see loader.ts's panelUrl).
  const widgetKey = new URLSearchParams(location.search).get('wk');
  const visitorToken = widgetKey ? (loadToken(widgetKey) ?? undefined) : undefined;
  postToLoader({ type: 'ready', visitorToken });

  composerEl?.focus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
