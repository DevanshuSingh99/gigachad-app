import { z } from 'zod';

import { CAPS } from './limits';

/**
 * Validation primitives used at every boundary. Parse, never cast — invariant 7
 * in docs/18-execution.md.
 */

export const uuid = z.string().uuid();

/**
 * Emails are compared and stored case-normalized, so normalization happens in the
 * schema rather than at call sites. `users.email` and `contacts.email` both rely
 * on this: two rows differing only in case would defeat their unique indexes.
 */
export const email = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email()
  .transform((v) => v.toLowerCase());

export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.');

export const personName = z.string().trim().min(1).max(120);

/**
 * Reserved workspace slugs. A slug becomes both an email local part
 * (`<slug>@inbound.<domain>`) and a public KB path segment, so anything that
 * collides with a platform hostname or route has to be refused at creation.
 */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'demo',
  'health',
  'inbound',
  'internal',
  'kb',
  'mail',
  'noreply',
  'no-reply',
  'postmaster',
  'public',
  'static',
  'support',
  'webhooks',
  'widget',
  'www',
]);

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers, and hyphens.',
  )
  .refine((v) => !v.includes('--'), 'Avoid consecutive hyphens.')
  .refine((v) => !RESERVED_SLUGS.has(v), 'That name is reserved.');

/** True for an IPv4 or IPv6 literal. A custom domain must be a name, not an address. */
export function isIpLiteral(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  return value.includes(':');
}

/**
 * Hostname *shape* only: a dotted FQDN, no scheme, no port, no path, not an IP
 * literal. Policy — reserved platform domains, localhost, private and link-local
 * ranges — is applied in the domains module, which knows the platform's own
 * hostnames. See docs/09-security.md.
 */
export const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .transform((v) => v.replace(/\.$/, ''))
  .refine((v) => !isIpLiteral(v), 'Enter a domain name, not an IP address.')
  .refine((v) => v.includes('.'), 'Enter a fully qualified domain name.')
  .refine(
    (v) => v.split('.').every((l) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l)),
    'That hostname is not valid.',
  );

/** Opaque, server-issued. Clients pass it back verbatim and never construct one. */
export const cursor = z.string().min(1).max(500);

export const pagination = z.object({
  cursor: cursor.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CAPS.pageSizeMax)
    .default(CAPS.pageSizeDefault),
});
export type Pagination = z.infer<typeof pagination>;

export const searchQuery = z.string().trim().max(CAPS.searchQueryChars);

/** Client-generated, required on every send: it is what makes a retry idempotent. */
export const clientMessageId = z.string().trim().min(8).max(100);

export const messageText = z.string().min(1).max(CAPS.messageTextChars);

/** A page of results plus the cursor to continue from, or null at the end. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
