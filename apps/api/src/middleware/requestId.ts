import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger';
import { newRequestId } from '../lib/ids';

/**
 * Assigns a request id and attaches a child logger carrying it.
 *
 * The id is always generated server-side and never read from an inbound header: a
 * client-supplied value would let a caller collide or forge log correlation.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = newRequestId();
  req.log = logger.child({ requestId: req.requestId });
  res.setHeader('x-request-id', req.requestId);
  next();
}
