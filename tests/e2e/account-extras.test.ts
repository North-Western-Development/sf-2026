import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret, hashPassword } from '@subspace/crypto';
import { transmitters, incidentReports, eq, or } from '@subspace/database';

/** Account Standing, phone numbers, avatar decorations and profile effects. */
describe('Account extras', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  const pilot = { id: '801756946623496193', username: 'acx_pilot' };
  const other = { id: '801756946623496194', username: 'acx_other' };
  const users = [pilot, other];
  const PASSWORD = 'correct horse battery';
  const auth = (u: { id: string; username: string }) => ({ authorization: `Bearer ${signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET)}` });
  const call = (method: string, url: string, u: { id: string; username: string }, payload?: unknown) =>
    app.inject({ method: method as any, url: `/api/v1${url}`, headers: auth(u), payload: payload as any });
  /** The code from the newest text in the development SMS outbox. */
  const lastCode = async () => {
    const raw = await (app as any).redis.lindex('dev:sms', 0);
    return /(\d{6})/.exec(JSON.parse(raw).body)![1];
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    const passwordHash = await hashPassword(PASSWORD);
    for (const u of users) {
      await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash, displayName: u.username, isEmailVerified: true });
    }
  });

  afterAll(async () => {
    if (db) {
      await db.delete(incidentReports).where(eq(incidentReports.reporterId, other.id));
      await db.delete(transmitters).where(or(...users.map((u) => eq(transmitters.id, u.id))));
    }
    await app.close();
  });

  it('reports all good, then the violations staff resolved, then a restriction', async () => {
    if (!db) return;
    expect((await call('GET', '/users/@me/standing', pilot)).json()).toMatchObject({ status: 'all_good', violations: [] });

    // An open report does not count; a resolved one does; a dismissed one does not.
    await db.insert(incidentReports).values([
      { reporterId: other.id, targetType: 'transmitter', targetId: pilot.id, reason: 'spam', status: 'open' },
      { reporterId: other.id, targetType: 'transmitter', targetId: pilot.id, reason: 'harassment', status: 'resolved', resolvedAt: new Date() },
      { reporterId: other.id, targetType: 'transmitter', targetId: pilot.id, reason: 'other', status: 'dismissed', resolvedAt: new Date() },
    ]);
    const limited = (await call('GET', '/users/@me/standing', pilot)).json();
    expect(limited.status).toBe('limited');
    expect(limited.violations).toHaveLength(1);
    expect(limited.violations[0]).toMatchObject({ kind: 'account', reason: 'harassment' });
    expect(JSON.stringify(limited)).not.toContain(other.id);

    await db.update(transmitters).set({ quarantinedAt: new Date(), quarantineReason: 'Spam waves' }).where(eq(transmitters.id, pilot.id));
    const restricted = (await call('GET', '/users/@me/standing', pilot)).json();
    expect(restricted.status).toBe('very_limited');
    expect(restricted.quarantined.reason).toBe('Spam waves');
    await db.update(transmitters).set({ quarantinedAt: null, quarantineReason: null }).where(eq(transmitters.id, pilot.id));
  });

  it('adds a phone number with a texted code, masks it, and removes it with the password', async () => {
    if (!db) return;
    expect((await call('POST', '/users/@me/phone', pilot, { phone: '555-0199', password: PASSWORD })).json().code).toBe('INVALID_PHONE');
    expect((await call('POST', '/users/@me/phone', pilot, { phone: '+1 555 010 0199', password: 'wrong' })).json().code).toBe('PASSWORD_INCORRECT');
    expect((await call('POST', '/users/@me/phone', pilot, { phone: '+1 (555) 010-0199', password: PASSWORD })).json()).toMatchObject({ sent: true, to: '+15550100199' });
    const code = await lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await call('POST', '/users/@me/phone/verify', pilot, { code: wrong })).json().code).toBe('INVALID_CODE');
    expect((await call('POST', '/users/@me/phone/verify', pilot, { code })).json().phone).toBe('+15550100199');
    // The code works once.
    expect((await call('POST', '/users/@me/phone/verify', pilot, { code })).statusCode).toBe(400);

    const me = (await call('GET', '/auth/me', pilot)).json().transmitter;
    expect(me.phone).toBe('+1 ******0199');
    // Nobody else sees it.
    const seen = (await call('GET', `/users/${pilot.id}/profile`, other)).json();
    expect(JSON.stringify(seen)).not.toContain('0199');

    // A number already on another account is refused.
    expect((await call('POST', '/users/@me/phone', other, { phone: '+15550100199', password: PASSWORD })).json().code).toBe('PHONE_TAKEN');

    expect((await call('DELETE', '/users/@me/phone', pilot, { password: 'wrong' })).json().code).toBe('PASSWORD_INCORRECT');
    expect((await call('DELETE', '/users/@me/phone', pilot, { password: PASSWORD })).json().phone).toBeNull();
    expect((await call('GET', '/auth/me', pilot)).json().transmitter.phone).toBeNull();
  });

  it('rations codes and verifications, voids a code after too many guesses, and refuses VPNs', async () => {
    if (!db) return;
    const redis = (app as any).redis;
    const saved = { ...process.env };
    const keys = async () => {
      const found: string[] = await redis.keys('phone:*');
      if (found.length) await redis.del(...found);
    };
    try {
      await keys();
      Object.assign(process.env, { PHONE_CODES_PER_USER: '2/24h', PHONE_VERIFY_PER_USER: '1/30d', PHONE_CODE_ATTEMPTS: '3' });
      const send = () => call('POST', '/users/@me/phone', other, { phone: '+15550100777', password: PASSWORD });
      expect((await send()).json().sent).toBe(true);
      // Three wrong guesses and the code is void, even the right one afterwards.
      const code = await lastCode();
      const wrong = code === '000000' ? '111111' : '000000';
      expect((await call('POST', '/users/@me/phone/verify', other, { code: wrong })).json().code).toBe('INVALID_CODE');
      expect((await call('POST', '/users/@me/phone/verify', other, { code: wrong })).json().code).toBe('INVALID_CODE');
      expect((await call('POST', '/users/@me/phone/verify', other, { code: wrong })).json().code).toBe('CODE_ATTEMPTS_EXCEEDED');
      expect((await call('POST', '/users/@me/phone/verify', other, { code })).json().code).toBe('INVALID_CODE');

      expect((await send()).json().sent).toBe(true);
      expect((await call('POST', '/users/@me/phone/verify', other, { code: await lastCode() })).json().phone).toBe('+15550100777');
      // Two codes a day: the third is refused. One verification a month: a new number waits.
      Object.assign(process.env, { PHONE_CODES_PER_USER: '5/24h' });
      const again = (await call('POST', '/users/@me/phone', other, { phone: '+15550100778', password: PASSWORD })).json();
      expect(again).toMatchObject({ code: 'PHONE_RATE_LIMITED', limit: 'PHONE_VERIFY_PER_USER' });
      Object.assign(process.env, { PHONE_CODES_PER_USER: '2/24h', PHONE_VERIFY_PER_USER: '5/30d' });
      expect((await call('POST', '/users/@me/phone', other, { phone: '+15550100778', password: PASSWORD })).json()).toMatchObject({ code: 'PHONE_RATE_LIMITED', limit: 'PHONE_CODES_PER_USER' });

      // Only the listed countries, and never from a VPN range.
      await keys();
      process.env.PHONE_COUNTRIES = '+44';
      expect((await send()).json().code).toBe('PHONE_COUNTRY_BLOCKED');
      delete process.env.PHONE_COUNTRIES;
      const list = path.join(os.tmpdir(), `vpn-ranges-${process.pid}.txt`);
      fs.writeFileSync(list, '# test ranges\n203.0.113.0/24\n127.0.0.0/8\n');
      process.env.PHONE_VPN_BLOCKLIST = list;
      expect((await send()).json().code).toBe('PHONE_VPN_BLOCKED');
      fs.rmSync(list);
    } finally {
      for (const k of Object.keys(process.env)) if (k.startsWith('PHONE_') && !(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      await keys();
      await db.update(transmitters).set({ phone: null, phoneVerifiedAt: null }).where(eq(transmitters.id, other.id));
    }
  });

  it('verifies mobile numbers only (no VoIP), and never a number another account verified first', async () => {
    if (!db) return;
    const redis = (app as any).redis;
    const clear = async () => {
      const keys: string[] = await redis.keys('phone:*');
      if (keys.length) await redis.del(...keys);
    };
    // A stand-in for Twilio Lookup's line type intelligence.
    const types: Record<string, string> = { '+15550100801': 'nonFixedVoip', '+15550100802': 'mobile', '+15550100803': 'tollFree' };
    const lookup = http.createServer((req, res) => {
      const number = decodeURIComponent(/PhoneNumbers\/([^?]+)/.exec(req.url ?? '')?.[1] ?? '');
      const ok = req.headers.authorization === `Basic ${Buffer.from('AC-test:secret').toString('base64')}`;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ phone_number: number, valid: true, line_type_intelligence: { type: types[number] ?? 'unknown' } }));
    });
    await new Promise<void>((r) => lookup.listen(0, '127.0.0.1', () => r()));
    const saved = { ...process.env };
    try {
      await clear();
      // Lookup credentials without TWILIO_FROM: texts still go to the dev outbox.
      Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC-test', TWILIO_AUTH_TOKEN: 'secret', TWILIO_LOOKUP_BASE: `http://127.0.0.1:${(lookup.address() as any).port}` });
      const send = (u: typeof pilot, phone: string) => call('POST', '/users/@me/phone', u, { phone, password: PASSWORD });
      expect((await send(pilot, '+15550100801')).json()).toMatchObject({ code: 'PHONE_LINE_TYPE_REFUSED', lineType: 'nonfixedvoip' });
      expect((await send(pilot, '+15550100803')).json()).toMatchObject({ code: 'PHONE_LINE_TYPE_REFUSED', lineType: 'tollfree' });

      // Both ask for the same mobile number; whoever confirms first keeps it.
      expect((await send(pilot, '+15550100802')).json().sent).toBe(true);
      const pilotCode = await lastCode();
      expect((await send(other, '+15550100802')).json().sent).toBe(true);
      expect((await call('POST', '/users/@me/phone/verify', other, { code: await lastCode() })).json().phone).toBe('+15550100802');
      expect((await call('POST', '/users/@me/phone/verify', pilot, { code: pilotCode })).json().code).toBe('PHONE_TAKEN');
      // And nobody is sent a code for it any more.
      expect((await send(pilot, '+15550100802')).json().code).toBe('PHONE_TAKEN');
    } finally {
      for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_LOOKUP_BASE']) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      lookup.close();
      await clear();
      await db.update(transmitters).set({ phone: null, phoneVerifiedAt: null, phonePending: null }).where(or(eq(transmitters.id, pilot.id), eq(transmitters.id, other.id)));
    }
  });

  it('turns phone verification off when texts cannot be sent', async () => {
    const saved = process.env.SMS_DEV_OUTBOX;
    try {
      delete process.env.SMS_DEV_OUTBOX;
      expect((await call('GET', '/users/@me/phone/config', pilot)).json()).toEqual({ available: false });
      expect((await call('POST', '/users/@me/phone', pilot, { phone: '+15550100199', password: PASSWORD })).json().code).toBe('SMS_UNAVAILABLE');
    } finally {
      process.env.SMS_DEV_OUTBOX = saved;
    }
    expect((await call('GET', '/users/@me/phone/config', pilot)).json()).toEqual({ available: true });
  });

  it('saves a known avatar decoration and profile effect, shows them to others, and refuses unknown ones', async () => {
    if (!db) return;
    expect((await call('PATCH', '/users/@me/profile', pilot, { avatarDecoration: 'crown' })).json().code).toBe('INVALID_DECORATION');
    expect((await call('PATCH', '/users/@me/profile', pilot, { profileEffect: 'fire' })).json().code).toBe('INVALID_EFFECT');
    const saved = (await call('PATCH', '/users/@me/profile', pilot, { avatarDecoration: 'orbit', profileEffect: 'aurora' })).json().transmitter;
    expect(saved).toMatchObject({ avatarDecoration: 'orbit', profileEffect: 'aurora' });
    const seen = (await call('GET', `/users/${pilot.id}/profile`, other)).json();
    expect(seen.user).toMatchObject({ avatarDecoration: 'orbit', profileEffect: 'aurora' });
    expect((await call('PATCH', '/users/@me/profile', pilot, { avatarDecoration: null, profileEffect: null })).json().transmitter).toMatchObject({ avatarDecoration: null, profileEffect: null });
  });
});
