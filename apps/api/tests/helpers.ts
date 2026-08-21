import crypto from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { env } from '../src/env';

export const ORIGIN = env.DASHBOARD_ORIGIN;
export const WIDGET_ORIGIN = 'http://widget.test';
export const WEBHOOK_SECRET = 'test-webhook-secret';

export function csrfFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  const line = cookies.find((c) => c.startsWith('gc_csrf='));
  if (!line) return '';
  return decodeURIComponent(line.split(';')[0]!.slice('gc_csrf='.length));
}

export function cookieHeader(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

export function signWebhook(body: Buffer): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

export async function signup(
  app: Express,
  input: { email: string; password: string; name: string; workspaceName: string },
) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/signup').set('Origin', ORIGIN).send(input);
  if (res.status !== 201) {
    throw new Error(`signup failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const csrf = csrfFrom(res);
  const me = res.body.data as {
    user: { id: string; email: string };
    memberships: Array<{ workspaceId: string; workspaceSlug: string; role: string }>;
  };
  const membership = me.memberships[0]!;
  return { agent, csrf, me, membership, cookies: cookieHeader(res) };
}

export function authed(agent: ReturnType<typeof request.agent>, csrf: string) {
  return {
    get: (url: string) => agent.get(url).set('Origin', ORIGIN),
    post: (url: string) =>
      agent.post(url).set('Origin', ORIGIN).set('x-csrf-token', csrf),
    patch: (url: string) =>
      agent.patch(url).set('Origin', ORIGIN).set('x-csrf-token', csrf),
    delete: (url: string) =>
      agent.delete(url).set('Origin', ORIGIN).set('x-csrf-token', csrf),
  };
}
