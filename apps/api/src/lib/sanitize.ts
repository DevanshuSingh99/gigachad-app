import sanitizeHtml from 'sanitize-html';

/**
 * HTML sanitization. Sanitize on write, per invariant and per the security threat
 * model (docs/09-security.md): "never render raw email HTML or model output."
 *
 * Two allowlists, not one — a chat reply and a knowledge base article are
 * different documents with different risk. The chat allowlist is intentionally
 * narrow: the dashboard composer is a plain Textarea. The knowledge base allowlist
 * is broader to accommodate a rich editor (Phase F).
 */

const CHAT_MESSAGE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'br', 'p', 'ul', 'ol', 'li'],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
  disallowedTagsMode: 'discard',
};

/**
 * Broader allowlist for knowledge base articles. Permits headings, images,
 * code blocks, blockquotes, tables, and hr — all content a helpdesk article
 * legitimately needs. Still strips scripts, event handlers, data: URIs, and
 * any attribute not in the explicit list.
 */
const ARTICLE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'b', 'strong', 'i', 'em', 'u', 's', 'mark', 'small',
    'a', 'img',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target', 'title'],
    img: ['src', 'alt', 'width', 'height'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['https'],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
  disallowedTagsMode: 'discard',
};

export function sanitizeChatMessageHtml(html: string): string {
  return sanitizeHtml(html, CHAT_MESSAGE_OPTIONS);
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, ARTICLE_OPTIONS);
}

/**
 * Strips all HTML tags and collapses whitespace to produce plain text suitable
 * for full-text indexing. The result is stored in `body_text` so search indexes
 * text content, not markup (indexing `body_html` would match "strong" for every
 * bolded article — docs/18-execution.md warning).
 */
export function extractBodyText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plain-text HTML escaping — NOT the sanitize-html allowlist above. This is for
 * values that are supposed to be plain text (titles, category names, a search
 * query echoed back into the page) and must never be interpreted as markup.
 * Used by the public KB templates (apps/api/src/kb-web/*.eta) for every
 * interpolated string EXCEPT `bodyHtml`, which is already sanitized on write via
 * `sanitizeArticleHtml` and would be double-escaped by this function.
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
