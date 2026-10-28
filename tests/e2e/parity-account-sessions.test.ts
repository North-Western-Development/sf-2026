import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { buildFileApp } from '../../apps/file-service/src/index.js';
import { hashPassword } from '@subspace/crypto';
import { transmitters, beacons, affiliations, eq, or } from '@subspace/database';

/**
 * Account settings that Discord has and that need the server: logged-in devices, email
 * change, password-gated username change, disabling and deleting the account.
 */
describe('Account: devices, email, username, disable and delete', () => {
  let app: FastifyInstance;
  let db: any;
  const PASSWORD = 'CorrectHorseBattery1';
  let ipCounter = 1;
  // Each sign-in from its own address so the per-IP login limit never interferes.
  const nextIp = () => `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  const ids = {
    devices: '795777221711495169',
    email: '795777221711495170',
    taken: '795777221711495171',
    rename: '795777221711495172',
    disable: '795777221711495173',
    remove: '795777221711495174',
    owner: '795777221711495175',
    friend: '795777221711495176',
    pwchange: '795777221711495177',
    suspended: '795777221711495178',
    staff: '795777221711495179',
  };
  const user = (k: keyof typeof ids) => ({ id: ids[k], username: `acct_${k}`, email: `acct_${k}@subspace.net` });

  const login = async (k: keyof typeof ids, extra: Record<string, unknown> = {}, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0') => {
    // These tests sign in far more than the per-account limit allows; that limit has its own test.
    await (app as any).redis?.del(`rl:login:account:${user(k).email}`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: nextIp(),
      headers: { 'user-agent': ua },
      payload: { username: user(k).email, password: PASSWORD, ...extra },
    });
    return res;
  };
  const session = async (k: keyof typeof ids, ua?: string) => {
    const res = await login(k, {}, ua);
    expect(res.statusCode).toBe(200);
    return res.json() as { accessToken: string; refreshToken: string };
  };
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const passwordHash = await hashPassword(PASSWORD);
    await db.delete(beacons).where(eq(beacons.ownerId, ids.owner));
    await db.delete(affiliations).where(or(eq(affiliations.transmitterId, ids.remove), eq(affiliations.targetId, ids.remove)));
    for (const k of Object.keys(ids) as Array<keyof typeof ids>) {
      const u = { ...user(k), passwordHash, displayName: `Acct ${k}`, disabledAt: null, deletedAt: null, tokenVersion: 0 };
      const [existing] = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (existing) await db.update(transmitters).set(u).where(eq(transmitters.id, u.id));
      else await db.insert(transmitters).values(u);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Instance suspension', () => {
    it('ends every session of a suspended account at once', async () => {
      if (!db) return;
      await db.update(transmitters).set({ staffRank: 2, isBanned: false }).where(eq(transmitters.id, ids.staff));
      await db.update(transmitters).set({ isBanned: false, staffRank: 0 }).where(eq(transmitters.id, ids.suspended));
      const victim = await session('suspended');
      const staff = await session('staff');
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(victim.accessToken) })).statusCode).toBe(200);
      const ban = await app.inject({ method: 'POST', url: `/api/v1/console/transmitters/${ids.suspended}/ban`, headers: as(staff.accessToken), payload: { reason: 'spam' } });
      expect(ban.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(victim.accessToken) });
      expect(after.statusCode).toBe(401);
      expect(after.json().code).toBe('SESSION_REVOKED');
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: victim.refreshToken } })).statusCode).toBe(401);
      await db.update(transmitters).set({ isBanned: false }).where(eq(transmitters.id, ids.suspended));
    });
  });

  describe('Logged-in devices', () => {
    it('lists every signed-in device and marks the current one', async () => {
      if (!db) return;
      const a = await session('devices', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0');
      await session('devices', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1');
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(a.accessToken) });
      expect(res.statusCode).toBe(200);
      const { sessions } = res.json();
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      expect(sessions.filter((s: any) => s.current)).toHaveLength(1);
      expect(sessions.some((s: any) => /iPhone/.test(s.userAgent))).toBe(true);
    });

    it('signing out one device kills its access and refresh tokens at once, not the caller', async () => {
      if (!db) return;
      const a = await session('devices');
      const b = await session('devices');
      const list = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(a.accessToken) })).json().sessions;
      const bId = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(b.accessToken) })).json().sessions.find((s: any) => s.current).id;
      expect(list.some((s: any) => s.id === bId)).toBe(true);

      const del = await app.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${bId}`, headers: as(a.accessToken) });
      expect(del.statusCode).toBe(204);

      const bMe = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(b.accessToken) });
      expect(bMe.statusCode).toBe(401);
      expect(bMe.json().code).toBe('SESSION_REVOKED');
      const bRefresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: b.refreshToken } });
      expect(bRefresh.statusCode).toBe(401);

      const aMe = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(a.accessToken) });
      expect(aMe.statusCode).toBe(200);
    });

    it('cannot sign out a session id that is not yours', async () => {
      if (!db) return;
      const a = await session('devices');
      const other = await session('email');
      const otherId = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(other.accessToken) })).json().sessions.find((s: any) => s.current).id;
      const del = await app.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${otherId}`, headers: as(a.accessToken) });
      expect(del.statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(other.accessToken) })).statusCode).toBe(200);
    });

    it('refreshing keeps the same device session instead of adding one', async () => {
      if (!db) return;
      const a = await session('devices');
      const before = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(a.accessToken) })).json().sessions;
      const refreshed = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: a.refreshToken } });
      expect(refreshed.statusCode).toBe(200);
      const after = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(refreshed.json().accessToken) })).json().sessions;
      expect(after).toHaveLength(before.length);
      expect(after.find((s: any) => s.current).id).toBe(before.find((s: any) => s.current).id);
    });

    it('logout removes the device; "log out all known devices" keeps only the caller', async () => {
      if (!db) return;
      const gone = await session('devices');
      const goneId = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(gone.accessToken) })).json().sessions.find((s: any) => s.current).id;
      const files = await buildFileApp();
      await files.ready();
      expect((await files.inject({ method: 'GET', url: '/api/v1/vault/quota', headers: as(gone.accessToken) })).statusCode).toBe(200);
      await app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: gone.refreshToken } });
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(gone.accessToken) })).statusCode).toBe(401);
      // The file service honours the sign-out as well, not just the API.
      const vault = await files.inject({ method: 'GET', url: '/api/v1/vault/quota', headers: as(gone.accessToken) });
      expect(vault.statusCode).toBe(401);
      expect(vault.json().code).toBe('SESSION_REVOKED');
      await files.close();

      const keep = await session('devices');
      await session('devices');
      const res = await app.inject({ method: 'DELETE', url: '/api/v1/auth/sessions', headers: as(keep.accessToken) });
      expect(res.statusCode).toBe(200);
      expect(res.json().revoked).toBeGreaterThanOrEqual(1);
      const left = (await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: as(keep.accessToken) })).json().sessions;
      expect(left).toHaveLength(1);
      expect(left[0].current).toBe(true);
      expect(left[0].id).not.toBe(goneId);
    });

    it('a password change signs other devices out immediately', async () => {
      if (!db) return;
      const mine = await session('pwchange');
      const other = await session('pwchange');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/me/password',
        headers: as(mine.accessToken),
        payload: { currentPassword: PASSWORD, newPassword: PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(other.accessToken) })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(mine.accessToken) })).statusCode).toBe(200);
    });
  });

  describe('Email change', () => {
    it('requires the current password, a valid and unused address', async () => {
      if (!db) return;
      const { accessToken } = await session('email');
      const patch = (payload: Record<string, unknown>) =>
        app.inject({ method: 'PATCH', url: '/api/v1/auth/me/email', headers: as(accessToken), payload });

      const wrong = await patch({ email: 'new_email@subspace.net', password: 'nope-nope' });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().code).toBe('PASSWORD_INCORRECT');
      expect((await patch({ email: 'new_email@subspace.net' })).json().code).toBe('PASSWORD_REQUIRED');
      expect((await patch({ email: 'not-an-email', password: PASSWORD })).json().code).toBe('INVALID_EMAIL');
      expect((await patch({ email: { $ne: 1 }, password: PASSWORD })).statusCode).toBe(400);
      const taken = await patch({ email: user('taken').email.toUpperCase(), password: PASSWORD });
      expect(taken.statusCode).toBe(409);
      expect(taken.json().code).toBe('EMAIL_TAKEN');
    });

    it('changes the email; the new one signs in', async () => {
      if (!db) return;
      const { accessToken } = await session('email');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/me/email',
        headers: as(accessToken),
        payload: { email: ' Changed_Email@Subspace.net ', password: PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().transmitter.email).toBe('changed_email@subspace.net');
      expect(res.json().transmitter.passwordHash).toBeUndefined();
      const signIn = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: nextIp(),
        payload: { username: 'changed_email@subspace.net', password: PASSWORD },
      });
      expect(signIn.statusCode).toBe(200);
      await db.update(transmitters).set({ email: user('email').email }).where(eq(transmitters.id, ids.email));
    });
  });

  describe('Username change', () => {
    it('needs the current password, like Discord', async () => {
      if (!db) return;
      const { accessToken } = await session('rename');
      const patch = (payload: Record<string, unknown>) =>
        app.inject({ method: 'PATCH', url: '/api/v1/users/@me/profile', headers: as(accessToken), payload });

      const missing = await patch({ username: 'acct_renamed' });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().code).toBe('PASSWORD_REQUIRED');
      const wrong = await patch({ username: 'acct_renamed', password: 'wrong-password' });
      expect(wrong.json().code).toBe('PASSWORD_INCORRECT');

      // Other profile fields still save without a password.
      expect((await patch({ bio: 'no password needed' })).statusCode).toBe(200);

      const ok = await patch({ username: 'acct_renamed', password: PASSWORD });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().transmitter.username).toBe('acct_renamed');
      await db.update(transmitters).set({ username: 'acct_rename' }).where(eq(transmitters.id, ids.rename));
    });
  });

  describe('Disable account', () => {
    it('signs every device out; signing in again offers to reactivate', async () => {
      if (!db) return;
      const a = await session('disable');
      const b = await session('disable');

      const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/me/disable', headers: as(a.accessToken), payload: { password: 'wrong' } });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().code).toBe('PASSWORD_INCORRECT');

      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/me/disable', headers: as(a.accessToken), payload: { password: PASSWORD } });
      expect(res.statusCode).toBe(204);
      for (const t of [a, b]) {
        expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(t.accessToken) })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: t.refreshToken } })).statusCode).toBe(401);
      }

      const blocked = await login('disable');
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().code).toBe('ACCOUNT_DISABLED');
      expect(blocked.json().accessToken).toBeUndefined();

      const back = await login('disable', { reactivate: true });
      expect(back.statusCode).toBe(200);
      const [row] = await db.select().from(transmitters).where(eq(transmitters.id, ids.disable));
      expect(row.disabledAt).toBeNull();
    });

    it('a wrong password never reveals that an account is disabled', async () => {
      if (!db) return;
      await db.update(transmitters).set({ disabledAt: new Date() }).where(eq(transmitters.id, ids.disable));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: nextIp(),
        payload: { username: user('disable').email, password: 'wrong-password', reactivate: true },
      });
      expect(res.statusCode).toBe(401);
      await db.update(transmitters).set({ disabledAt: null }).where(eq(transmitters.id, ids.disable));
    });
  });

  describe('Delete account', () => {
    it('refuses while the account owns beacons', async () => {
      if (!db) return;
      await db.insert(beacons).values({ name: 'Owned Station', ownerId: ids.owner });
      const { accessToken } = await session('owner');
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/me/delete', headers: as(accessToken), payload: { password: PASSWORD } });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('OWNS_BEACONS');
      expect(res.json().beacons.map((b: any) => b.name)).toContain('Owned Station');
      const [row] = await db.select().from(transmitters).where(eq(transmitters.id, ids.owner));
      expect(row.deletedAt).toBeNull();
    });

    it('anonymises the account, drops friendships and blocks sign-in', async () => {
      if (!db) return;
      await db.insert(affiliations).values({ transmitterId: ids.remove, targetId: ids.friend, status: 'accepted' });
      const { accessToken } = await session('remove');

      const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/me/delete', headers: as(accessToken), payload: {} });
      expect(wrong.json().code).toBe('PASSWORD_REQUIRED');

      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/me/delete', headers: as(accessToken), payload: { password: PASSWORD } });
      expect(res.statusCode).toBe(204);

      const [row] = await db.select().from(transmitters).where(eq(transmitters.id, ids.remove));
      expect(row.username).toBe('deleted_user');
      expect(row.displayName).toBe('Deleted User');
      expect(row.email).not.toContain('acct_remove');
      expect(row.deletedAt).not.toBeNull();
      const friends = await db.select().from(affiliations).where(or(eq(affiliations.transmitterId, ids.remove), eq(affiliations.targetId, ids.remove)));
      expect(friends).toHaveLength(0);

      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: as(accessToken) })).statusCode).toBe(401);
      const signIn = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: nextIp(),
        payload: { username: user('remove').email, password: PASSWORD },
      });
      expect(signIn.statusCode).toBe(401);
    });
  });
});
