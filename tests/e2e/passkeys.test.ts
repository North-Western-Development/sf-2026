import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { hashPassword } from '@subspace/crypto';
import { transmitters, transmitterPasskeys, eq } from '@subspace/database';

/**
 * Passkey endpoints that do not need a real authenticator (the browser suite covers the
 * full WebAuthn ceremony with Chrome's virtual authenticator).
 */
describe('Passkeys: API guards', () => {
  let app: FastifyInstance;
  let db: any;
  const PASSWORD = 'CorrectHorseBattery1';
  const user = { id: 'e5000000-0000-4000-8000-000000000001', username: 'pk_user', email: 'pk_user@subspace.net' };
  const ORIGIN = { origin: 'http://localhost:4173' };
  let access = '';
  const as = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${access}`, ...ORIGIN, ...extra });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    const passwordHash = await hashPassword(PASSWORD);
    await db.delete(transmitterPasskeys).where(eq(transmitterPasskeys.transmitterId, user.id));
    const [existing] = await db.select().from(transmitters).where(eq(transmitters.id, user.id)).limit(1);
    if (existing) await db.update(transmitters).set({ passwordHash, disabledAt: null, deletedAt: null }).where(eq(transmitters.id, user.id));
    else await db.insert(transmitters).values({ ...user, passwordHash, displayName: 'PK User' });
    await (app as any).redis?.del(`rl:login:account:${user.email}`);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.99.0.1', payload: { username: user.email, password: PASSWORD } });
    access = login.json().accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs the current password to start adding a passkey', async () => {
    if (!db) return;
    const none = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/register/options', headers: as(), payload: {} });
    expect(none.statusCode).toBe(400);
    expect(none.json().code).toBe('PASSWORD_REQUIRED');
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/register/options', headers: as(), payload: { password: 'nope' } });
    expect(wrong.json().code).toBe('PASSWORD_INCORRECT');

    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/register/options', headers: as(), payload: { password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    const { options } = ok.json();
    expect(options.rp).toEqual({ name: 'Subspace Frequency', id: 'localhost' });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(options.user.name).toMatch(/^pk_user#\d{4}$/);
  });

  it('refuses origins that are not this site', async () => {
    if (!db) return;
    for (const origin of ['https://evil.example', 'not a url']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/login/options', headers: { origin } });
      expect(res.statusCode, origin).toBe(400);
      expect(res.json().code).toBe('WEBAUTHN_ORIGIN');
    }
  });

  it('rejects a forged registration and makes the challenge single-use', async () => {
    if (!db) return;
    await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/register/options', headers: as(), payload: { password: PASSWORD } });
    const forged = { id: 'AAAA', rawId: 'AAAA', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'oA' }, clientExtensionResults: {} };
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/register/verify', headers: as(), payload: { response: forged } });
    expect(first.statusCode).toBe(400);
    expect(first.json().code).toBe('PASSKEY_INVALID');
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/register/verify', headers: as(), payload: { response: forged } });
    expect(replay.json().code).toBe('CHALLENGE_EXPIRED');
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: as() })).json().passkeys).toEqual([]);
  });

  it('signs nobody in with an unknown credential or a reused challenge', async () => {
    if (!db) return;
    const start = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/login/options', headers: ORIGIN });
    expect(start.statusCode).toBe(200);
    const { options, challengeId } = start.json();
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials ?? []).toEqual([]);
    const assertion = { id: 'unknown-credential', rawId: 'unknown-credential', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' }, clientExtensionResults: {} };
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/login/verify', headers: ORIGIN, payload: { challengeId, response: assertion } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('PASSKEY_UNKNOWN');
    expect(res.json().accessToken).toBeUndefined();
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/passkeys/login/verify', headers: ORIGIN, payload: { challengeId, response: assertion } });
    expect(again.json().code).toBe('CHALLENGE_EXPIRED');
  });

  it('keeps other people’s passkeys out of reach', async () => {
    if (!db) return;
    const [other] = await db.select().from(transmitters).where(eq(transmitters.username, 'pk_user')).limit(1);
    expect(other).toBeTruthy();
    const missing = '00000000-0000-4000-8000-0000000000aa';
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/auth/passkeys/${missing}`, headers: as(), payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/v1/auth/passkeys/${missing}/delete`, headers: as(), payload: { password: PASSWORD } })).statusCode).toBe(404);
  });
});
