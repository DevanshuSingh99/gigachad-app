import { ZodError } from 'zod';
import {
  ERROR_MESSAGE,
  ERROR_STATUS,
  type ErrorCode,
  type FieldErrors,
} from '@gigachad/shared';

/**
 * The only error type handlers throw. One error middleware formats every
 * response from it (invariant 8, docs/18-execution.md).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  /** Seconds, surfaced as the Retry-After header. Required on every 429. */
  readonly retryAfterSeconds?: number;
  /** Server-side only. Never serialized to a client. */
  readonly detail?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fieldErrors?: FieldErrors;
      retryAfterSeconds?: number;
      detail?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_MESSAGE[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.detail) this.detail = options.detail;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * A foreign-workspace resource and a nonexistent one must be indistinguishable,
 * so there is deliberately no "forbidden resource" helper — invariant 4.
 * `detail` records which resource it was for the server-side log only.
 */
export function notFound(resource?: string): AppError {
  return new AppError('NOT_FOUND', resource ? { detail: { resource } } : {});
}

export function unauthenticated(reason?: string): AppError {
  return new AppError('UNAUTHENTICATED', reason ? { detail: { reason } } : {});
}

export function forbiddenRole(required: string): AppError {
  return new AppError('FORBIDDEN_ROLE', {
    message: `This action requires the ${required} role.`,
    detail: { required },
  });
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError('RATE_LIMITED', { retryAfterSeconds });
}

/** Flattens a Zod error into the `fieldErrors` map the dashboard renders inline. */
export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    // First message per field: the UI shows one message per input.
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}

export function validationFailed(error: ZodError): AppError {
  return new AppError('VALIDATION_FAILED', { fieldErrors: fieldErrorsFromZod(error) });
}
