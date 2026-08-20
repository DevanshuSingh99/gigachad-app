import {
  WIDGET_NAMESPACE,
  isWidgetMessage,
  type OpenMessage,
  type CloseMessage,
  type InitMessage,
  type PanelToLoaderMessage,
} from './protocol';

/**
 * The widget loader. Dependency-free, no framework, under 15KB gzipped
 * (checked by `npm run check-size` — docs/18-execution.md, Phase D). Every
 * class name and id is namespaced under `gc-` so it cannot collide with the
 * host page's CSS, and every style lives inline on the elements this script
 * creates rather than in a stylesheet the host page could ever see or override.
 *
 * It does exactly two things: render a launcher button, and lazily create an
 * iframe the first time someone opens it. Nothing else loads until that click —
 * the panel bundle, its CSS, and its socket connection all wait for it, so a
 * host page that never gets a visitor to open the widget pays nothing beyond
 * this file.
 */

declare const WIDGET_API_URL: string;
declare const WIDGET_WS_URL: string;

const LAUNCHER_ID = 'gc-widget-launcher';
const BADGE_ID = 'gc-widget-badge';
const IFRAME_ID = 'gc-widget-iframe';

function currentScript(): HTMLScriptElement {
  // document.currentScript is only reliable synchronously at parse time, which
  // is exactly when this module-level code runs — even for an async script.
  const script = document.currentScript;
  if (script instanceof HTMLScriptElement) return script;
  // Fallback for a bundler/loader context where currentScript is unavailable:
  // the last <script> tag naming this file is almost always the right one.
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="widget.js"]');
  const last = scripts[scripts.length - 1];
  if (!last) throw new Error('gigachad widget: could not locate its own <script> tag.');
  return last;
}

function panelUrl(scriptSrc: string, widgetKey: string): string {
  // The panel needs its widgetKey BEFORE it can look up its own stored visitor
  // token (the storage key is namespaced by it) — and that lookup has to
  // happen before the panel's first message to the loader (`ready`, which
  // carries the token so the loader's session fetch can attempt a resume). A
  // query param is what makes the key available synchronously at the panel's
  // own boot, without waiting on a postMessage round trip first.
  const url = new URL('./panel/', scriptSrc);
  url.searchParams.set('wk', widgetKey);
  return url.href;
}

interface SessionBootstrapResult {
  session: import('./protocol').WidgetSessionResult | null;
  sessionError?: string;
}

/**
 * Creates or resumes the widget session. Runs in the loader precisely because
 * the loader — unlike the panel — executes at the host page's real origin; see
 * protocol.ts's InitMessage for why that is load-bearing here.
 */
async function bootstrapSession(visitorToken: string | undefined): Promise<SessionBootstrapResult> {
  try {
    const res = await fetch(`${WIDGET_API_URL}/api/v1/widget/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgetKey: currentScript().dataset.widgetKey, visitorToken }),
    });
    const payload = (await res.json().catch(() => null)) as
      | { data: import('./protocol').WidgetSessionResult }
      | { error: { code: string; message: string } }
      | null;

    if (!res.ok || !payload || !('data' in payload)) {
      const message = payload && 'error' in payload ? payload.error.message : 'Could not start a chat session.';
      return { session: null, sessionError: message };
    }
    return { session: payload.data };
  } catch {
    return { session: null, sessionError: 'Could not reach the chat server.' };
  }
}

function injectLauncherStyles(): void {
  const style = document.createElement('style');
  style.id = 'gc-widget-styles';
  // Scoped entirely to elements carrying our own ids/classes — never a bare
  // element selector, which is what would leak into the host page's own markup.
  style.textContent = `
    #${LAUNCHER_ID} {
      position: fixed;
      right: 20px;
      bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      z-index: 2147483000;
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      border: none;
      background: #2563eb;
      color: #fff;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font: 500 24px/1 system-ui, sans-serif;
    }
    #${LAUNCHER_ID}:focus-visible {
      outline: 2px solid #93c5fd;
      outline-offset: 2px;
    }
    #${BADGE_ID} {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9999px;
      background: #dc2626;
      color: #fff;
      font: 600 11px/18px system-ui, sans-serif;
      text-align: center;
    }
    #${IFRAME_ID} {
      position: fixed;
      right: 20px;
      bottom: calc(88px + env(safe-area-inset-bottom, 0px));
      z-index: 2147483000;
      width: 380px;
      max-width: calc(100vw - 24px);
      height: 600px;
      max-height: calc(100dvh - 120px);
      border: none;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
      display: none;
      color-scheme: light;
    }
    /* Below 480px the panel goes full-screen rather than floating — a 380px
       card on a 375px viewport is unusable (docs/15-frontend-and-widget.md). */
    @media (max-width: 480px) {
      #${IFRAME_ID} {
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100dvh;
        max-width: 100vw;
        max-height: 100dvh;
        border-radius: 0;
      }
    }
    #${IFRAME_ID}.gc-open {
      display: block;
    }
  `;
  document.head.appendChild(style);
}

function init(): void {
  const script = currentScript();
  const widgetKey = script.dataset.widgetKey;
  if (!widgetKey) {
    console.error('gigachad widget: missing data-widget-key on the script tag.');
    return;
  }

  const iframeSrc = panelUrl(script.src, widgetKey);
  let iframe: HTMLIFrameElement | null = null;
  let isOpen = false;
  let panelReady = false;

  injectLauncherStyles();

  const launcher = document.createElement('button');
  launcher.id = LAUNCHER_ID;
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.textContent = '💬';

  const badge = document.createElement('span');
  badge.id = BADGE_ID;
  badge.style.display = 'none';
  launcher.appendChild(badge);

  function postToPanel(message: InitMessage | OpenMessage | CloseMessage): void {
    iframe?.contentWindow?.postMessage(message, new URL(iframeSrc).origin);
  }

  function ensureIframe(): HTMLIFrameElement {
    if (iframe) return iframe;
    iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = iframeSrc;
    iframe.title = 'Chat';
    iframe.setAttribute('role', 'dialog');
    // The panel's own CSP sets frame-ancestors to this workspace's allowed
    // origins (docs/09-security.md) — this attribute only controls what the
    // PANEL, as a nested browsing context, may itself request; the isolation
    // that matters runs the other direction, enforced server-side.
    iframe.allow = '';
    document.body.appendChild(iframe);
    return iframe;
  }

  function open(): void {
    isOpen = true;
    const frame = ensureIframe();
    frame.classList.add('gc-open');
    launcher.setAttribute('aria-expanded', 'true');
    if (panelReady) postToPanel({ ns: WIDGET_NAMESPACE, type: 'open' });
    badge.style.display = 'none';
  }

  function close(): void {
    isOpen = false;
    iframe?.classList.remove('gc-open');
    launcher.setAttribute('aria-expanded', 'false');
    postToPanel({ ns: WIDGET_NAMESPACE, type: 'close' });
    launcher.focus();
  }

  launcher.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });

  window.addEventListener('message', (event: MessageEvent) => {
    // Ignoring anything not from the panel's own origin is the whole security
    // property of this listener — the host page can send whatever it wants,
    // and none of it reaches here.
    if (event.origin !== new URL(iframeSrc).origin) return;
    if (!isWidgetMessage(event.data)) return;

    const message = event.data as PanelToLoaderMessage;
    switch (message.type) {
      case 'ready':
        panelReady = true;
        // This fetch — not one made from inside the panel — is what makes the
        // Origin allowlist check mean anything: this code runs in the host
        // page's real execution context, so the browser sets a genuine,
        // unspoofable Origin header on it. See protocol.ts's InitMessage.
        void bootstrapSession(message.visitorToken).then((result) => {
          postToPanel({
            ns: WIDGET_NAMESPACE,
            type: 'init',
            widgetKey,
            hostPageUrl: location.href,
            locale: navigator.language,
            apiUrl: WIDGET_API_URL,
            wsUrl: WIDGET_WS_URL,
            ...result,
          });
          if (isOpen) postToPanel({ ns: WIDGET_NAMESPACE, type: 'open' });
        });
        break;
      case 'resize':
        if (iframe && window.innerWidth > 480) {
          iframe.style.height = `${Math.min(Math.max(message.height, 320), 720)}px`;
        }
        break;
      case 'unread':
        if (message.count > 0 && !isOpen) {
          badge.textContent = message.count > 9 ? '9+' : String(message.count);
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
        break;
      case 'closeRequest':
        // Escape pressed with focus inside the iframe — the panel cannot close
        // itself (see protocol.ts's CloseRequestMessage).
        if (isOpen) close();
        break;
    }
  });

  document.body.appendChild(launcher);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
