import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@gigachad/shared';
import { ERROR_MESSAGE } from '@gigachad/shared';

import { env } from '../env';
import { AppError, isAppError, validationFailed } from '../lib/errors';

/**
 * The single place an error becomes a response. Invariant 8: handlers throw a
 * typed AppError and this formats every one of them into
 * `{ error: { code, message, requestId, fieldErrors? } }`.
 *
 * Clients receive code, message, and requestId only. Stack traces, causes, and
 * the `detail` bag stay in the server log — the requestId is the thread between
 * the two.
 */

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

function normalize(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof ZodError) return validationFailed(err);

  // express.json() failures arrive as generic errors with a `type` discriminator.
  const parserError = err as BodyParserError;
  if (parserError?.type === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', { cause: err });
  }
  if (parserError?.type === 'entity.parse.failed') {
    return new AppError('VALIDATION_FAILED', {
      message: 'The request body is not valid JSON.',
      cause: err,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      // Unique constraint. Callers that can distinguish which constraint was hit
      // throw a more specific code themselves; this is the safe fallback.
      case 'P2002':
        return new AppError('SLUG_TAKEN', {
          detail: { target: err.meta?.target },
          cause: err,
        });
      // Record required for the operation was not found.
      case 'P2025':
        return new AppError('NOT_FOUND', { cause: err });
      // Foreign key constraint failed — a client-supplied id pointed at a row
      // that is not visible in this workspace.
      case 'P2003':
        return new AppError('NOT_FOUND', { cause: err });
      default:
        return new AppError('INTERNAL', { cause: err });
    }
  }

  return new AppError('INTERNAL', {
    message: err instanceof Error ? err.message : 'Unknown error',
    cause: err,
  });
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    // Nothing useful left to say to the client; make sure it is not silent.
    req.log?.error({ err }, 'error after response headers were sent');
    next(err);
    return;
  }

  const appError = normalize(err);

  const logFields = {
    errorCode: appError.code,
    status: appError.status,
    ...(appError.detail ? { detail: appError.detail } : {}),
  };

  if (appError.status >= 500) {
    req.log?.error({ ...logFields, err: appError, cause: appError.cause }, appError.message);
  } else {
    req.log?.warn(logFields, appError.message);
  }

  // Retry-After is mandatory on every 429 (docs/16-errors-and-limits.md).
  if (appError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      // An internal failure never explains itself to a client in production.
      message:
        appError.status >= 500 && env.isProduction
          ? ERROR_MESSAGE[appError.code]
          : appError.message,
      requestId: req.requestId ?? 'unknown',
      ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
    },
  };

  res.status(appError.status).json(body);
}

/** Terminal handler for a path no router claimed. */
export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', { detail: { path: req.path } }));
}
