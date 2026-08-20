import type { Request } from 'express';
import type { z } from 'zod';

import { validationFailed } from '../lib/errors';

/**
 * Boundary parsing. Parse, do not cast (invariant 7).
 *
 * These are called at the top of a handler rather than mounted as middleware so
 * the parsed, narrowed value is what the rest of the handler sees — a middleware
 * that validates and then hands on `req.body` leaves every downstream line still
 * looking at `any`.
 */

export function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) throw validationFailed(result.error);
  return result.data;
}

export function parseQuery<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw validationFailed(result.error);
  return result.data;
}

export function parseParams<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.params);
  if (!result.success) throw validationFailed(result.error);
  return result.data;
}
