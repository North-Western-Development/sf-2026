import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { transmitters, eq, like } from '@subspace/database';
import { startMailSink } from '../support/mail-sink.js';

/** Email verification over real SMTP (a local sink): sign-up, resend, email change, expiry. */
describe('Email verification', () => {
  let app: FastifyInstance;
  let db: any;
  let sink: Awaited<ReturnType<typeof startMailSink>>;
  const ORIGIN = 'http://localhost:4173';
  const PASSWORD = 'CorrectHorseBattery1';
  const saved: Record<string, string | undefined> = {};
  const stamp = Date.now().toString(36);
  const email = (k: string) => `verify_${k}_${stamp}@subspace.test`;
  const tokenFrom = (text: string) => /verify-email\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

  async function register(k: string, displayName = `Verify ${k}`) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      remoteAddress: `10.77.0.${Math.floor(Math.random() * 200) + 1}`,
      headers: { origin: ORIGIN },
      payload: { username: `verify_${k}_${stamp}`.slice(0, 32), email: email(k), password: PASSWORD, displayName, acceptDirectives: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { accessToken: string; transmitter: { id: string; isEmailVerified: boolean } };
  }
  const verify = (token: string) => app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
  const me = async (access: string) => (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${access}` } })).json().transmitter;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    sink = await startMailSink();
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_INSECURE', 'SMTP_SECURE', 'SMTP_USER', 'EMAIL_LINK_BASE', 'REGISTER_RATE_LIMIT']) saved[k] = process.env[k];
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_INSECURE: 'true', SMTP_SECURE: 'false', REGISTER_RATE_LIMIT: '1000' });
    delete process.env.SMTP_USER;
    delete process.env.EMAIL_LINK_BASE;
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (db) await db.delete(transmitters).where(like(transmitters.email, `verify_%_${stamp}@subspace.test`));
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    await app.close();
    await sink.close();
  });

  it('signs up unverified, emails a link, and the link verifies once', async () => {
    if (!db) return;
    const account = await register('a', 'Nova <b>Prime</b>');
    expect(account.transmitter.isEmailVerified).toBe(false);
    const mail = await sink.waitFor(email('a'), /Verify your Subspace Frequency email/);
    expect(mail.text).toContain(`${ORIGIN}/verify-email?token=`);
    // Names are escaped in the HTML version.
    expect(mail.html).toContain('Nova &#60;b&#62;Prime');
    expect(mail.html).not.toContain('<b>Prime</b>');

    const [row] = await db.select().from(transmitters).where(eq(transmitters.id, account.transmitter.id));
    expect(row.emailVerificationCode).not.toContain(tokenFrom(mail.text));

    expect((await verify('x'.repeat(43))).json().code).toBe('TOKEN_INVALID');
    expect((await verify(tokenFrom(mail.text))).statusCode).toBe(200);
    expect((await me(account.accessToken)).isEmailVerified).toBe(true);
    expect((await verify(tokenFrom(mail.text))).json().code).toBe('TOKEN_INVALID');

    const resend = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: { authorization: `Bearer ${account.accessToken}` } });
    expect(resend.statusCode).toBe(409);
  });

  it('resends a fresh link (the old one stops working) and limits how often', async () => {
    if (!db) return;
    const account = await register('b');
    const first = tokenFrom((await sink.waitFor(email('b'), /Verify/)).text);
    const auth = { authorization: `Bearer ${account.accessToken}`, origin: ORIGIN };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: auth })).statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    const mails = sink.inbox.filter((m) => m.to.includes(email('b')));
    expect(mails).toHaveLength(2);
    const second = tokenFrom(mails[1].text);
    expect(second).not.toBe(first);
    expect((await verify(first)).statusCode).toBe(400);

    await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: auth });
    await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: auth });
    const limited = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: auth });
    expect(limited.statusCode).toBe(429);
  });

  it('changing the email needs verifying again and tells the old address', async () => {
    if (!db) return;
    const account = await register('c');
    await verify(tokenFrom((await sink.waitFor(email('c'), /Verify/)).text));
    const next = email('c2');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/email',
      headers: { authorization: `Bearer ${account.accessToken}`, origin: ORIGIN },
      payload: { email: next, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().transmitter.isEmailVerified).toBe(false);
    const notice = await sink.waitFor(email('c'), /email was changed/);
    expect(notice.text).toContain('v•••@subspace.test');
    const link = await sink.waitFor(next, /Verify/);
    expect((await verify(tokenFrom(link.text))).statusCode).toBe(200);
  });

  it('expired links are refused', async () => {
    if (!db) return;
    const account = await register('d');
    const token = tokenFrom((await sink.waitFor(email('d'), /Verify/)).text);
    const [row] = await db.select().from(transmitters).where(eq(transmitters.id, account.transmitter.id));
    const [hash, , ...rest] = row.emailVerificationCode.split(':');
    await db.update(transmitters).set({ emailVerificationCode: `${hash}:${Date.now() - 1000}:${rest.join(':')}` }).where(eq(transmitters.id, row.id));
    const res = await verify(token);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TOKEN_EXPIRED');
  });

  it('never puts a forged origin into the emailed link', async () => {
    if (!db) return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      remoteAddress: '10.77.1.9',
      headers: { origin: 'https://evil.example' },
      payload: { username: `verify_e_${stamp}`.slice(0, 32), email: email('e'), password: PASSWORD, acceptDirectives: true },
    });
    expect(res.statusCode).toBe(201);
    const mail = await sink.waitFor(email('e'), /Verify/);
    expect(mail.text).not.toContain('evil.example');
  });

  it('rations verification emails and finished verifications per account, address and network', async () => {
    if (!db) return;
    const redis = (app as any).redis;
    const clear = async () => {
      const keys: string[] = await redis.keys('email:*');
      if (keys.length) await redis.del(...keys);
    };
    const saved = { ...process.env };
    try {
      await clear();
      Object.assign(process.env, { EMAIL_CODES_PER_USER: '2/24h', EMAIL_VERIFY_PER_USER: '1/30d', EMAIL_CODES_PER_IP: '1000/1m', EMAIL_CODES_PER_ADDRESS: '1000/1m', EMAIL_VERIFY_PER_IP: '1000/1m' });
      const account = await register('f');
      const auth = { authorization: `Bearer ${account.accessToken}`, origin: ORIGIN };
      await sink.waitFor(email('f'), /Verify/);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: auth })).statusCode).toBe(202);
      const limited = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email/resend', headers: auth });
      expect(limited.json()).toMatchObject({ code: 'EMAIL_RATE_LIMITED', limit: 'EMAIL_CODES_PER_USER' });

      // One finished verification a month: a changed address waits.
      await new Promise((r) => setTimeout(r, 300));
      const latest = sink.inbox.filter((m) => m.to.includes(email('f'))).at(-1)!;
      expect((await verify(tokenFrom(latest.text))).statusCode).toBe(200);
      process.env.EMAIL_CODES_PER_USER = '1000/1m';
      await app.inject({ method: 'PATCH', url: '/api/v1/auth/me/email', headers: auth, payload: { email: email('f2'), password: PASSWORD } });
      const again = await verify(tokenFrom((await sink.waitFor(email('f2'), /Verify/)).text));
      expect(again.json()).toMatchObject({ code: 'EMAIL_RATE_LIMITED', limit: 'EMAIL_VERIFY_PER_USER' });

      // Sign-ups from one network: one verification email, then no more accounts that need one.
      await clear();
      process.env.EMAIL_CODES_PER_IP = '1/24h';
      const signUp = (k: string) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          remoteAddress: '10.77.2.2',
          headers: { origin: ORIGIN },
          payload: { username: `verify_${k}_${stamp}`.slice(0, 32), email: email(k), password: PASSWORD, acceptDirectives: true },
        });
      expect((await signUp('g')).statusCode).toBe(201);
      expect((await signUp('h')).json()).toMatchObject({ code: 'EMAIL_RATE_LIMITED', limit: 'EMAIL_CODES_PER_IP' });
    } finally {
      for (const k of Object.keys(process.env)) if (k.startsWith('EMAIL_') && !(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      await clear();
    }
  });
});
