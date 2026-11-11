import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type { Account } from './accounts.ts';

export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
}

interface GoogleSession {
  readCookie: (req: FastifyRequest, name: string) => string | undefined;
  cookie: (name: string, value: string, maxAge: number, path: string) => string;
  sign: (payload: string) => string;
  setSession: (reply: FastifyReply, account: Account) => Promise<unknown>;
  resolveIdentity: (identity: { sub: string; email: string; hd?: string }, linkingId: string | null) => Promise<Account | 'account-exists' | null | undefined>;
}

const START = '/api/auth/google';
const CALLBACK = '/api/auth/google/callback';
const FLOW_COOKIE = 'wl_google';
const FLOW_SECONDS = 600;
const random = () => randomBytes(32).toString('base64url');
const callbackQuery = z.object({ code: z.string().min(1).max(2048), state: z.string().length(43) });

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerGoogleAuth(app: FastifyInstance, options: GoogleOptions, session: GoogleSession) {
  const redirectUri = new URL(CALLBACK, options.publicUrl).href;
  const client = new OAuth2Client(options.clientId, options.clientSecret, redirectUri);
  const flowCookie = (value: string, age: number) => session.cookie(FLOW_COOKIE, value, age, CALLBACK);

  app.get(START, async (req, reply) => {
    const state = random();
    const nonce = random();
    const verifier = random();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const payload = `${Date.now() + FLOW_SECONDS * 1000}.${state}.${nonce}.${verifier}.${req.account?.id ?? '0'}`;
    const params = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email',
      prompt: 'select_account',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return reply.header('Cache-Control', 'no-store')
      .header('Set-Cookie', flowCookie(`${payload}.${session.sign(payload)}`, FLOW_SECONDS))
      .redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get(CALLBACK, async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('Set-Cookie', flowCookie('', 0));
    const failed = () => reply.redirect('/?login=google-error');
    const query = callbackQuery.safeParse(req.query);
    const flow = session.readCookie(req, FLOW_COOKIE);
    const [expires, state, nonce, verifier, linkingId, signature, extra] = flow?.split('.') ?? [];
    if (!query.success || !expires || !state || !nonce || !verifier || !linkingId || !signature || extra !== undefined ||
        !(Number(expires) > Date.now()) || !equal(query.data.state, state) ||
        !equal(signature, session.sign(`${expires}.${state}.${nonce}.${verifier}.${linkingId}`)) ||
        (linkingId !== '0' && req.account?.id !== linkingId)) return failed();

    try {
      const { tokens } = await client.getToken({
        code: query.data.code, codeVerifier: verifier, redirect_uri: redirectUri,
      });
      if (!tokens.id_token) return failed();
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: options.clientId });
      const identity = ticket.getPayload();
      if (!identity?.email_verified || !identity.email ||
          identity.nonce !== nonce || !identity.sub) return failed();
      const account = await session.resolveIdentity({ sub: identity.sub, email: identity.email, hd: identity.hd }, linkingId === '0' ? null : linkingId);
      if (account === 'account-exists') return reply.redirect('/?login=google-account-exists');
      if (!account) return failed();
      await session.setSession(reply, account);
      return reply.redirect('/');
    } catch {
      req.log.warn('No se pudo completar la autenticación con Google.');
      return failed();
    }
  });
}
