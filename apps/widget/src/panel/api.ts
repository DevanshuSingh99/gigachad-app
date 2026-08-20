/**
 * The panel's own tiny fetch wrapper for `/api/v1/widget/*`.
 *
 * No Zod here: validation is the server's job at the boundary it actually
 * matters (docs invariant 7); the panel only needs the response shapes, which
 * arrive as type-only imports from @gigachad/shared and are erased at build
 * time — importing them costs this bundle nothing.
 */
import type { ApiErrorBody } from '@gigachad/shared';

export class WidgetApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ApiConfig {
  apiUrl: string;
  getToken: () => string | null;
}

export async function widgetFetch<T>(
  config: ApiConfig,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = config.getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['x-widget-token'] = token;

  const res = await fetch(`${config.apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = (await res.json().catch(() => null)) as { data?: T } & Partial<ApiErrorBody> | null;

  if (!res.ok) {
    throw new WidgetApiError(payload?.error?.code ?? 'INTERNAL', payload?.error?.message ?? 'Request failed.');
  }
  return payload!.data as T;
}
