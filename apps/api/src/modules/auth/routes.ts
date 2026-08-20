import { Router } from 'express';
import { loginInput, signupInput } from '@gigachad/shared';

import { clearCsrfCookie, clearSessionCookie } from '../../lib/cookies';
import { issueSessionCookies } from '../../lib/sessions';
import { rateLimit } from '../../lib/rateLimit';
import { authOf, requireAuth } from '../../middleware/requireAuth';
import { parseBody } from '../../middleware/validate';
import * as service from './service';

export const authRouter = Router();

/**
 * Rate limits are mounted as route middleware, so they run before the handler and
 * therefore before the Argon2 verification — the most expensive thing an
 * unauthenticated caller can make this box do (invariant 9).
 */
const emailFromBody = (req: { body?: unknown }): string | null => {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;
};

authRouter.post('/signup', rateLimit('signupPerIp'), async (req, res) => {
  const input = parseBody(req, signupInput);
  const { me, session } = await service.signup(input);
  issueSessionCookies(res, session);
  res.status(201).json({ data: me });
});

authRouter.post(
  '/login',
  // Two windows: per IP catches one host trying many accounts, per email catches a
  // distributed attempt against one account. Both are needed; neither covers the
  // other (docs/16-errors-and-limits.md).
  rateLimit('loginPerIp'),
  rateLimit('loginPerEmail', emailFromBody),
  async (req, res) => {
    const input = parseBody(req, loginInput);
    const { me, session } = await service.login(input);
    issueSessionCookies(res, session);
    res.json({ data: me });
  },
);

authRouter.post('/logout', requireAuth, async (req, res) => {
  // Revoked server-side, not merely un-set in the browser: a copied cookie has to
  // stop working too.
  await service.logout(authOf(req).sessionId);
  clearSessionCookie(res);
  clearCsrfCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await service.me(authOf(req).user) });
});
