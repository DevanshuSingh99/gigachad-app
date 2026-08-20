import { z } from 'zod';

import { AppError, notFound } from './errors';
import { CAPS, type Page } from '@gigachad/shared';

/**
 * Shared repository plumbing.
 *
 * Two rules this file exists to make cheap to follow:
 *   1. Every repository function takes a `WorkspaceScope` and puts that predicate
 *      in the query. Route handlers never build queries. The guard in src/db.ts
 *      enforces the predicate mechanically; this type is what makes passing the
 *      scope the obvious thing to do at every call site.
 *   2. A missing row and a row in another workspace are the same outcome: 404.
 *      `requireFound` is the only place that decision is made, so no handler can
 *      accidentally return 403 for a foreign resource and confirm it exists.
 */

export interface WorkspaceScope {
  readonly workspaceId: string;
}

/**
 * Unwraps a scoped lookup. Because the lookup was scoped, a null result means
 * "not visible to this workspace", which is deliberately indistinguishable from
 * "does not exist" (invariant 4).
 */
export function requireFound<T>(value: T | null | undefined, resource?: string): T {
  if (value === null || value === undefined) throw notFound(resource);
  return value;
}

// ─── Cursor pagination ────────────────────────────────────────────────────────

/**
 * Cursors are opaque to clients: a versioned, base64url-encoded keyset position.
 * Keyset rather than offset because the inbox is sorted by activity and rows move
 * between pages under offset pagination while an agent is reading them.
 */
const CURSOR_VERSION = 1;

export function encodeCursor(position: Record<string, string | number>): string {
  const payload = JSON.stringify({ v: CURSOR_VERSION, ...position });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor<S extends z.ZodTypeAny>(cursor: string, schema: S): z.infer<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_FAILED', { fieldErrors: { cursor: 'Invalid cursor.' } });
  }
  const withVersion = z.object({ v: z.literal(CURSOR_VERSION) }).safeParse(parsed);
  if (!withVersion.success) {
    throw new AppError('VALIDATION_FAILED', { fieldErrors: { cursor: 'Invalid cursor.' } });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', { fieldErrors: { cursor: 'Invalid cursor.' } });
  }
  return result.data;
}

/** One extra row is fetched to learn whether another page exists. */
export function takeWithLookahead(limit: number): number {
  return Math.min(limit, CAPS.pageSizeMax) + 1;
}

/**
 * Splits a lookahead result into a page plus the cursor to continue from.
 * `positionOf` returns the keyset position of the last row on the page.
 */
export function toPage<TRow, TOut>(
  rows: TRow[],
  limit: number,
  map: (row: TRow) => TOut,
  positionOf: (row: TRow) => Record<string, string | number>,
): Page<TOut> {
  const effectiveLimit = Math.min(limit, CAPS.pageSizeMax);
  const hasMore = rows.length > effectiveLimit;
  const pageRows = hasMore ? rows.slice(0, effectiveLimit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(map),
    nextCursor: hasMore && last ? encodeCursor(positionOf(last)) : null,
  };
}
