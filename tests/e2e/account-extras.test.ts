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
  const pilot = { id: 'fe100000-0000-4000-8000-000000000001', username: 'acx_pilot' };
  const other = { id: 'fe100000-0000-4000-8000-000000000002', username: 'acx_other' };
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
