import sanitizeHtml from 'sanitize-html';

/**
 * HTML sanitization. Sanitize on write, per invariant and per the security threat
 * model (docs/09-security.md): "never render raw email HTML or model output."
 *
 * Two allowlists, not one — a chat reply and a knowledge base article are
 * different documents with different risk. The chat allowlist is intentionally
 * narrow: the dashboard composer is a plain Textarea (docs/15-frontend-and-widget.md
 * lists no rich-text component for the conversation view), so `bodyHtml` on a
 * message is defense in depth for a future or API-direct caller, not something the
 * current UI produces. The knowledge base gets its own, broader allowlist in
 * Phase F, where a rich editor is an explicit requirement.
 */

const CHAT_MESSAGE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'br', 'p', 'ul', 'ol', 'li'],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  // Only network-fetchable schemes — no javascript:, data:, or vbscript: links.
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    // A sanitizer gap in a chat message would otherwise open the host page (or,
    // once the widget ships, the customer's page) to a reverse-tabnabbing link.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
  disallowedTagsMode: 'discard',
};

export function sanitizeChatMessageHtml(html: string): string {
  return sanitizeHtml(html, CHAT_MESSAGE_OPTIONS);
}
