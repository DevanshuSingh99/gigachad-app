import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { db } from '../src/db';
import { redis } from '../src/lib/redis';
import { attachSocketServer } from '../src/realtime/io';
import type { IoServer } from '../src/realtime/types';
import { ORIGIN, WIDGET_ORIGIN, authed, signWebhook, signup } from './helpers';

const PASSWORD = 'correcthorsebatterystaple';

interface Tenant {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  workspaceId: string;
  slug: string;
  widgetKey: string;
  cookies: string;
  conversationId: string;
  contactId: string;
  articleId: string;
  articleSlug: string;
  domainId: string;
  widgetToken: string;
}

let app: ReturnType<typeof createApp>;
let a!: Tenant;
let b!: Tenant;
let io: IoServer | undefined;
let httpServer: ReturnType<typeof createServer> | undefined;
let socketUrl = '';
let integrationReady = false;

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      'Skipping integration tests: Postgres/Redis are not reachable on localhost. Start them with `docker compose up -d postgres redis`.',
    );
    return;
  }

  app = createApp();
  httpServer = createServer(app);
  io = attachSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer!.listen(0, resolve));
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind test server');
  socketUrl = `http://127.0.0.1:${addr.port}`;

  const stamp = Date.now();
  const userA = await signup(app, {
    email: `a-${stamp}@example.com`,
    password: PASSWORD,
    name: 'Admin A',
    workspaceName: `Acme ${stamp}`,
  });
  const userB = await signup(app, {
    email: `b-${stamp}@example.com`,
    password: PASSWORD,
    name: 'Admin B',
    workspaceName: `Beta ${stamp}`,
  });

  a = await provision(userA, `docs-${stamp}-a`);
  b = await provision(userB, `docs-${stamp}-b`);
  integrationReady = true;
});

afterAll(async () => {
  io?.close();
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  }
  await Promise.allSettled([db.$disconnect(), redis.quit()]);
});

async function provision(
  user: Awaited<ReturnType<typeof signup>>,
  articleSlug: string,
): Promise<Tenant> {
  const api = authed(user.agent, user.csrf);
  const ws = await api.get(`/api/v1/workspaces/${user.membership.workspaceId}`);
  expect(ws.status).toBe(200);
  const widgetKey = ws.body.data.widgetKey as string;

  const patched = await api.patch(`/api/v1/workspaces/${user.membership.workspaceId}`).send({
    settings: { allowedWidgetOrigins: [WIDGET_ORIGIN] },
  });
  expect(patched.status).toBe(200);

  const session = await request(app)
    .post('/api/v1/widget/session')
    .set('Origin', WIDGET_ORIGIN)
    .send({ widgetKey, name: 'Visitor' });
  expect(session.status).toBe(201);
  const widgetToken = session.body.data.token as string;
  const contactId = session.body.data.contact.id as string;

  const sent = await request(app)
    .post('/api/v1/widget/conversations/new/messages')
    .set('Origin', WIDGET_ORIGIN)
    .set('x-widget-token', widgetToken)
    .send({ bodyText: 'hello from widget', clientMessageId: `cm_${randomUUID()}` });
  expect(sent.status).toBe(201);
  const conversationId = sent.body.data.conversationId as string;

  const article = await api.post(`/api/v1/workspaces/${user.membership.workspaceId}/kb/articles`).send({
    title: 'Refund policy',
    slug: articleSlug,
    bodyHtml: '<p>Refunds within 30 days.</p>',
  });
  expect(article.status).toBe(201);

  const domain = await api.post(`/api/v1/workspaces/${user.membership.workspaceId}/domains`).send({
    hostname: `${articleSlug}.customers.example`,
  });
  expect(domain.status).toBe(201);

  return {
    agent: user.agent,
    csrf: user.csrf,
    workspaceId: user.membership.workspaceId,
    slug: user.membership.workspaceSlug,
    widgetKey,
    cookies: user.cookies,
    conversationId,
    contactId,
    articleId: article.body.data.id as string,
    articleSlug,
    domainId: domain.body.data.id as string,
    widgetToken,
  };
}

describe('tenant isolation', () => {
  beforeEach(({ skip }) => {
    if (!integrationReady) skip();
  });
  it("1. A's member reading B's conversation gets 404, not 403", async () => {
    const res = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations/${b.conversationId}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("2. A's member posting a message to B's conversation gets 404", async () => {
    const res = await authed(a.agent, a.csrf)
      .post(`/api/v1/workspaces/${a.workspaceId}/conversations/${b.conversationId}/messages`)
      .send({ bodyText: 'nope', clientMessageId: `cm_${randomUUID()}` });
    expect(res.status).toBe(404);
  });

  it("3. A's member reading B's contact gets 404", async () => {
    const res = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/contacts/${b.contactId}`,
    );
    expect(res.status).toBe(404);
  });

  it("4. A's member patching B's KB article gets 404", async () => {
    const res = await authed(a.agent, a.csrf)
      .patch(`/api/v1/workspaces/${a.workspaceId}/kb/articles/${b.articleId}`)
      .send({ title: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it("5. A's member listing conversations never receives a B row", async () => {
    const res = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations`,
    );
    expect(res.status).toBe(200);
    const ids = (res.body.data.items as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(a.conversationId);
    expect(ids).not.toContain(b.conversationId);
  });

  it("6. A's Admin reading or mutating B's custom domain gets 404", async () => {
    const read = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${b.workspaceId}/domains`,
    );
    expect(read.status).toBe(404);

    const mutate = await authed(a.agent, a.csrf).delete(
      `/api/v1/workspaces/${a.workspaceId}/domains/${b.domainId}`,
    );
    expect(mutate.status).toBe(404);
  });
});

describe('socket isolation', () => {
  beforeEach(({ skip }) => {
    if (!integrationReady) skip();
  });
  it("7. a B socket cannot subscribe to A's conversation, and A's messages do not arrive", async () => {
    const connect = (cookies: string, workspaceId: string) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = ioClient(socketUrl, {
          transports: ['websocket'],
          extraHeaders: { Origin: ORIGIN, Cookie: cookies },
          auth: { workspaceId },
        });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', (err) => reject(err));
      });

    const socketA = await connect(a.cookies, a.workspaceId);
    const socketB = await connect(b.cookies, b.workspaceId);

    const ackB = await new Promise<{ ok: boolean }>((resolve) => {
      socketB.emit(
        'conversation:subscribe',
        { conversationId: a.conversationId, lastSequence: 0 },
        (result: { ok: boolean }) => resolve(result),
      );
    });
    expect(ackB.ok).toBe(false);

    const leaked = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 800);
      socketB.on('message:new', (payload: { conversationId: string }) => {
        if (payload.conversationId === a.conversationId) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });

    await new Promise<{ ok: boolean }>((resolve) => {
      socketA.emit(
        'conversation:subscribe',
        { conversationId: a.conversationId, lastSequence: 0 },
        (result: { ok: boolean }) => resolve(result),
      );
    });

    const send = await authed(a.agent, a.csrf)
      .post(`/api/v1/workspaces/${a.workspaceId}/conversations/${a.conversationId}/messages`)
      .send({ bodyText: 'only for A', clientMessageId: `cm_${randomUUID()}` });
    expect(send.status).toBe(201);

    expect(await leaked).toBe(false);
    socketA.close();
    socketB.close();
  });
});

describe('widget token scope', () => {
  beforeEach(({ skip }) => {
    if (!integrationReady) skip();
  });
  it('8. a widget token cannot reach /api/v1/workspaces/*', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${a.workspaceId}`)
      .set('x-widget-token', a.widgetToken);
    expect(res.status).toBe(401);
  });

  it("9. a widget token cannot read another contact's conversation in the same workspace", async () => {
    const other = await request(app)
      .post('/api/v1/widget/session')
      .set('Origin', WIDGET_ORIGIN)
      .send({ widgetKey: a.widgetKey, name: 'Other visitor' });
    expect(other.status).toBe(201);
    const otherToken = other.body.data.token as string;

    const res = await request(app)
      .get(`/api/v1/widget/conversations/${a.conversationId}/messages`)
      .set('Origin', WIDGET_ORIGIN)
      .set('x-widget-token', otherToken);
    expect(res.status).toBe(404);
  });
});

describe('email webhook', () => {
  beforeEach(({ skip }) => {
    if (!integrationReady) skip();
  });
  function inboundBody(overrides: Record<string, unknown> = {}) {
    return {
      Uuid: [randomUUID()],
      MessageId: `<${randomUUID()}@example.com>`,
      From: { Name: 'Customer', Address: 'customer@example.com' },
      To: [{ Name: '', Address: `${a.slug}@inbound.test` }],
      Recipients: [`${a.slug}@inbound.test`],
      SentAtDate: new Date().toISOString(),
      Subject: 'Need help',
      Text: 'Hello',
      Html: '<p>Hello</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      ...overrides,
    };
  }

  it('10. forged signature and stale timestamp are rejected without persisting', async () => {
    const before = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations`,
    );
    const countBefore = (before.body.data.items as unknown[]).length;

    const forged = Buffer.from(JSON.stringify(inboundBody()), 'utf8');
    const forgedRes = await request(app)
      .post('/api/v1/webhooks/email/inbound')
      .set('x-sib-webhook-signature', 'deadbeef')
      // NOT 'application/json': superagent serializes any non-string .send()
      // payload whose Content-Type resolves to JSON, and Buffer's own toJSON()
      // turns it into `{"type":"Buffer","data":[...]}` before it hits the wire
      // — so the bytes actually sent would never match what signWebhook()
      // signed, and every one of these "signed" requests would 401 regardless
      // of whether the signature logic is even correct. The real route accepts
      // any content type here (express.raw({ type: '*/*' })), so this changes
      // nothing about what's under test.
      .set('Content-Type', 'application/octet-stream')
      .send(forged);
    expect(forgedRes.status).toBeGreaterThanOrEqual(400);

    const stale = Buffer.from(
      JSON.stringify(inboundBody({ SentAtDate: '2020-01-01T00:00:00.000Z' })),
      'utf8',
    );
    const staleRes = await request(app)
      .post('/api/v1/webhooks/email/inbound')
      .set('x-sib-webhook-signature', signWebhook(stale))
      // NOT 'application/json': superagent serializes any non-string .send()
      // payload whose Content-Type resolves to JSON, and Buffer's own toJSON()
      // turns it into `{"type":"Buffer","data":[...]}` before it hits the wire
      // — so the bytes actually sent would never match what signWebhook()
      // signed, and every one of these "signed" requests would 401 regardless
      // of whether the signature logic is even correct. The real route accepts
      // any content type here (express.raw({ type: '*/*' })), so this changes
      // nothing about what's under test.
      .set('Content-Type', 'application/octet-stream')
      .send(stale);
    expect(staleRes.status).toBeGreaterThanOrEqual(400);

    const after = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations`,
    );
    expect((after.body.data.items as unknown[]).length).toBe(countBefore);
  });

  it('11. the same provider event ID delivered twice produces exactly one message', async () => {
    const uuid = randomUUID();
    const payload = inboundBody({ Uuid: [uuid] });
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = signWebhook(raw);

    const first = await request(app)
      .post('/api/v1/webhooks/email/inbound')
      .set('x-sib-webhook-signature', sig)
      // NOT 'application/json': superagent serializes any non-string .send()
      // payload whose Content-Type resolves to JSON, and Buffer's own toJSON()
      // turns it into `{"type":"Buffer","data":[...]}` before it hits the wire
      // — so the bytes actually sent would never match what signWebhook()
      // signed, and every one of these "signed" requests would 401 regardless
      // of whether the signature logic is even correct. The real route accepts
      // any content type here (express.raw({ type: '*/*' })), so this changes
      // nothing about what's under test.
      .set('Content-Type', 'application/octet-stream')
      .send(raw);
    expect(first.status).toBe(200);
    expect(first.body.data.routed).toBe(true);
    const conversationId = first.body.data.conversationId as string;

    const second = await request(app)
      .post('/api/v1/webhooks/email/inbound')
      .set('x-sib-webhook-signature', sig)
      // NOT 'application/json': superagent serializes any non-string .send()
      // payload whose Content-Type resolves to JSON, and Buffer's own toJSON()
      // turns it into `{"type":"Buffer","data":[...]}` before it hits the wire
      // — so the bytes actually sent would never match what signWebhook()
      // signed, and every one of these "signed" requests would 401 regardless
      // of whether the signature logic is even correct. The real route accepts
      // any content type here (express.raw({ type: '*/*' })), so this changes
      // nothing about what's under test.
      .set('Content-Type', 'application/octet-stream')
      .send(raw);
    expect(second.status).toBe(200);

    const messages = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations/${conversationId}/messages`,
    );
    expect(messages.status).toBe(200);
    expect(messages.body.data.items).toHaveLength(1);
  });
});

describe('sanitization', () => {
  beforeEach(({ skip }) => {
    if (!integrationReady) skip();
  });
  it('12. a script payload in an article body is stripped on write and inert on render', async () => {
    const created = await authed(a.agent, a.csrf)
      .post(`/api/v1/workspaces/${a.workspaceId}/kb/articles`)
      .send({
        title: 'XSS',
        slug: `xss-${Date.now()}`,
        bodyHtml: '<p>safe</p><script>alert(1)</script>',
      });
    expect(created.status).toBe(201);
    expect(String(created.body.data.bodyHtml).toLowerCase()).not.toContain('script');

    await authed(a.agent, a.csrf).post(
      `/api/v1/workspaces/${a.workspaceId}/kb/articles/${created.body.data.id}/publish`,
    );

    const page = await request(app).get(
      `/api/v1/public/${a.slug}/kb/articles/${created.body.data.slug}`,
    );
    expect(page.status).toBe(200);
    expect(page.text.toLowerCase()).not.toContain('<script');
  });

  it('13. inbound email HTML containing script and event-handler attributes is stripped', async () => {
    const payload = {
      Uuid: [randomUUID()],
      MessageId: `<${randomUUID()}@example.com>`,
      From: { Name: 'Customer', Address: 'html@example.com' },
      To: [{ Name: '', Address: `${a.slug}@inbound.test` }],
      Recipients: [`${a.slug}@inbound.test`],
      SentAtDate: new Date().toISOString(),
      Subject: 'html',
      Text: 'plain',
      Html: '<p>hi</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const res = await request(app)
      .post('/api/v1/webhooks/email/inbound')
      .set('x-sib-webhook-signature', signWebhook(raw))
      // NOT 'application/json': superagent serializes any non-string .send()
      // payload whose Content-Type resolves to JSON, and Buffer's own toJSON()
      // turns it into `{"type":"Buffer","data":[...]}` before it hits the wire
      // — so the bytes actually sent would never match what signWebhook()
      // signed, and every one of these "signed" requests would 401 regardless
      // of whether the signature logic is even correct. The real route accepts
      // any content type here (express.raw({ type: '*/*' })), so this changes
      // nothing about what's under test.
      .set('Content-Type', 'application/octet-stream')
      .send(raw);
    expect(res.status).toBe(200);
    const conversationId = res.body.data.conversationId as string;
    const messages = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations/${conversationId}/messages`,
    );
    const html = String(messages.body.data.items[0].bodyHtml ?? '');
    expect(html.toLowerCase()).not.toContain('script');
    expect(html.toLowerCase()).not.toContain('onerror');
  });
});

describe('core correctness', () => {
  beforeEach(({ skip }) => {
    if (!integrationReady) skip();
  });
  it('14. the same clientMessageId sent twice yields one message and returns the original', async () => {
    const clientMessageId = `cm_${randomUUID()}`;
    const first = await authed(a.agent, a.csrf)
      .post(`/api/v1/workspaces/${a.workspaceId}/conversations/${a.conversationId}/messages`)
      .send({ bodyText: 'once', clientMessageId });
    expect(first.status).toBe(201);
    const second = await authed(a.agent, a.csrf)
      .post(`/api/v1/workspaces/${a.workspaceId}/conversations/${a.conversationId}/messages`)
      .send({ bodyText: 'once', clientMessageId });
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.sequence).toBe(first.body.data.sequence);
  });

  it('15. invalid status transitions are rejected; a new customer message reopens a resolved conversation', async () => {
    const invalid = await authed(a.agent, a.csrf)
      .patch(`/api/v1/workspaces/${a.workspaceId}/conversations/${a.conversationId}`)
      .send({ snoozedUntil: new Date(Date.now() + 3600_000).toISOString() });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(invalid.body.error.code).toBe('INVALID_TRANSITION');

    const resolved = await authed(a.agent, a.csrf)
      .patch(`/api/v1/workspaces/${a.workspaceId}/conversations/${a.conversationId}`)
      .send({ status: 'RESOLVED' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('RESOLVED');

    const customer = await request(app)
      .post(`/api/v1/widget/conversations/${a.conversationId}/messages`)
      .set('Origin', WIDGET_ORIGIN)
      .set('x-widget-token', a.widgetToken)
      .send({ bodyText: 'still here', clientMessageId: `cm_${randomUUID()}` });
    expect(customer.status).toBe(201);

    const reopened = await authed(a.agent, a.csrf).get(
      `/api/v1/workspaces/${a.workspaceId}/conversations/${a.conversationId}`,
    );
    expect(reopened.body.data.status).toBe('OPEN');
  });
});
