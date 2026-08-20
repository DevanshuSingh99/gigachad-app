import type { ApiErrorBody, ErrorCode, FieldErrors } from '@gigachad/shared';

/**
 * The dashboard's only path to the backend.
 *
 * Two things every call gets, without any call site remembering:
 *   * `credentials: 'include'` — the session is an HttpOnly cookie on the shared
 *     apex domain, not a token this code could read.
 *   * the `{ data }` / `{ error }` envelope unwrapped into a value or a typed
 *     ApiError, so components branch on a stable `code` rather than on a message.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  // Fails at module load rather than on the first request, so a misconfigured
  // Pages build is obvious immediately.
  throw new Error('NEXT_PUBLIC_API_URL is not set. See apps/dashboard/.env.example');
}

export const apiUrl = API_URL;

export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK';
  readonly status: number;
  readonly requestId: string | null;
  readonly fieldErrors: FieldErrors | null;

  constructor(init: {
    code: ErrorCode | 'NETWORK';
    message: string;
    status: number;
    requestId?: string | null;
    fieldErrors?: FieldErrors | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.fieldErrors = init.fieldErrors ?? null;
  }

  /** Error screens show the request id so a report correlates with the logs. */
  get isRetryable(): boolean {
    return this.code === 'NETWORK' || this.status >= 500 || this.status === 429;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Sent as x-workspace-id; the server validates membership before using it. */
  workspaceId?: string;
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

/**
 * Reads the `gc_csrf` cookie set by the API (apps/api/src/lib/cookies.ts).
 * It's deliberately non-HttpOnly so this can read it and echo it back as a
 * header — the double-submit half of CSRF defense (apps/api/src/middleware/csrf.ts).
 */
function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\s*)gc_csrf=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, workspaceId, headers, ...rest } = options;

  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  if (workspaceId) requestHeaders.set('x-workspace-id', workspaceId);

  const method = (rest.method ?? 'GET').toUpperCase();
  if (STATE_CHANGING.has(method)) {
    const csrfToken = readCsrfCookie();
    if (csrfToken) requestHeaders.set('x-csrf-token', csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: requestHeaders,
      // The whole reason the dashboard has to live on a subdomain of the API's
      // apex domain: without this the session cookie is never sent.
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    throw new ApiError({
      code: 'NETWORK',
      message: 'Could not reach the server. Check your connection and try again.',
      status: 0,
    });
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as ApiErrorBody | null;
    throw new ApiError({
      code: envelope?.error?.code ?? 'INTERNAL',
      message: envelope?.error?.message ?? `Request failed with status ${response.status}.`,
      status: response.status,
      requestId: envelope?.error?.requestId ?? response.headers.get('x-request-id'),
      fieldErrors: envelope?.error?.fieldErrors ?? null,
    });
  }

  return (payload as { data: T }).data;
}
