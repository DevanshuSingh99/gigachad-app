import { describe, expect, it } from 'vitest';

import { trimNewestFirstContext } from '../src/lib/ai/context';
import { __testing as dbGuard } from '../src/db';
import { AppError } from '../src/lib/errors';
import { __testing as logTesting } from '../src/lib/logger';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { sanitizeArticleHtml, sanitizeChatMessageHtml } from '../src/lib/sanitize';
import { isReservedSlug, slugify } from '../src/lib/slug';
import { assertSafeHostname } from '../src/modules/domains/service';
import { boundReferenceChain } from '../src/modules/email/repo';
import { hostname } from '@gigachad/shared';

describe('sanitize', () => {
  it('strips script tags from article HTML', () => {
    const html = sanitizeArticleHtml('<p>ok</p><script>alert(1)</script>');
    expect(html).toContain('<p>ok</p>');
    expect(html.toLowerCase()).not.toContain('script');
  });

  it('strips event handlers from chat HTML', () => {
    const html = sanitizeChatMessageHtml('<p onclick="alert(1)">hi</p><img src=x onerror=alert(1)>');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('<img');
  });
});

describe('logger redaction', () => {
  it('redacts secrets by key name at any depth', () => {
    const out = logTesting.redactDeep({
      passwordHash: 'secret',
      nested: { apiKey: 'x', bodyText: 'customer message' },
    }) as Record<string, unknown>;
    expect(out.passwordHash).toBe('[redacted]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.apiKey).toBe('[redacted]');
    expect(nested.bodyText).toBe('[redacted]');
  });
});

describe('slugify', () => {
  it('transliterates and hyphenates a workspace name', () => {
    expect(slugify('Acme Support')).toBe('acme-support');
  });

  it('treats reserved words as reserved', () => {
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('acme')).toBe(false);
  });
});

describe('hostname policy', () => {
  it('accepts a public FQDN shape', () => {
    expect(hostname.parse('help.customer.com')).toBe('help.customer.com');
  });

  it('rejects localhost and IP literals', () => {
    expect(() => assertSafeHostname('localhost')).toThrow(AppError);
    expect(() => assertSafeHostname('127.0.0.1')).toThrow(AppError);
    expect(() => hostname.parse('10.0.0.1')).toThrow();
  });
});

describe('References chain bounding', () => {
  it('keeps the first id plus the most recent 8', () => {
    const prev = ['first', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const next = boundReferenceChain(prev, 'new');
    expect(next[0]).toBe('first');
    expect(next).toHaveLength(9);
    expect(next.at(-1)).toBe('new');
    expect(next).not.toContain('a');
  });

  it('starts a chain from an empty list', () => {
    expect(boundReferenceChain([], 'm1')).toEqual(['m1']);
  });
});

describe('AI context windowing', () => {
  it('drops oldest (end) lines first while keeping at least one', () => {
    const lines = ['newest', 'mid', 'oldest-that-is-very-long-'.repeat(20)];
    const kept = trimNewestFirstContext(lines, 40);
    expect(kept[0]).toBe('newest');
    expect(kept.join('\n\n').length).toBeLessThanOrEqual(40);
  });
});

describe('tenant-scope predicate', () => {
  it('accepts a top-level workspaceId and rejects OR-only scoping', () => {
    expect(dbGuard.hasWorkspacePredicate({ workspaceId: 'w' })).toBe(true);
    expect(dbGuard.hasWorkspacePredicate({ OR: [{ workspaceId: 'w' }, { id: 'x' }] })).toBe(
      false,
    );
  });
});

describe('password hashing', () => {
  it('verifies an Argon2id hash', async () => {
    const hashed = await hashPassword('a-strong-password');
    expect(await verifyPassword(hashed, 'a-strong-password')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong-password')).toBe(false);
  });
});
