import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { hashPassword, generateTotpSecret, verifyTotpToken, generateCurrentTotpCode, signAccessToken } from '@subspace/crypto';
import { transmitters, eq } from '@subspace/database';

describe('Parity Section 8: Account (password, 2FA, rate limits) E2E Suite', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'subspace_jwt_super_secret_key_2026';
  let app: FastifyInstance;

  const userId = 'd0000000-0000-0000-0000-000000000001';
  const PLAIN_PASSWORD = 'CorrectHorseBattery1';
  let userToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    const db = (app as any).db;
    if (db) {
      const passwordHash = await hashPassword(PLAIN_PASSWORD);
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, userId)).limit(1);
      if (existing.length === 0) {
        await db.insert(transmitters).values({
          id: userId,
          username: 'account_holder',
          email: 'account_holder@subspace.net',
          passwordHash,
          displayName: 'Account Holder',
        });
      } else {
        await db.update(transmitters).set({ passwordHash, tokenVersion: 0, is2faEnabled: false, totpSecret: null }).where(eq(transmitters.id, userId));
      }
    }

    userToken = signAccessToken({ transmitterId: userId, username: 'account_holder', staffRank: 0 }, JWT_SECRET);
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s password change without a token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/password',
      payload: { currentPassword: PLAIN_PASSWORD, newPassword: 'NewPassword123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('400s on the wrong current password', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/password',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { currentPassword: 'totally-wrong', newPassword: 'NewPassword123' },
    });
    // Must not be 401: the web client treats 401 as an expired session and signs out.
    expect(res.statusCode).toBe(400);
  });

  it('400s on a too-short new password (schema validation)', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/password',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { currentPassword: PLAIN_PASSWORD, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('changes the password and revokes every refresh token issued before it', async () => {
    if (!(app as any).db) return;

    // Establish an "other session" refresh token before the password change.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'account_holder', password: PLAIN_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const otherSessionRefresh = loginRes.json().refreshToken;

    const changeRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me/password',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { currentPassword: PLAIN_PASSWORD, newPassword: 'NewPassword123' },
    });
    expect(changeRes.statusCode).toBe(200);
    const newSessionRefresh = changeRes.json().refreshToken;
    expect(newSessionRefresh).toBeDefined();

    // The pre-change refresh token is now dead.
    const oldRefreshAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: otherSessionRefresh },
    });
    expect(oldRefreshAttempt.statusCode).toBe(401);

    // The freshly issued refresh token from the password-change response still works.
    const newRefreshAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: newSessionRefresh },
    });
    expect(newRefreshAttempt.statusCode).toBe(200);

    // Old password no longer authenticates.
    const oldLoginAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'account_holder', password: PLAIN_PASSWORD },
    });
    expect(oldLoginAttempt.statusCode).toBe(401);
  });

  it('enables then disables 2FA, and rejects disable with a bad code', async () => {
    if (!(app as any).db) return;
    const db = (app as any).db;

    // Set up 2FA directly against a known TOTP secret (bypassing the QR/setup UX).
    const { secret } = generateTotpSecret('Subspace Frequency', 'account_holder');
    await db.update(transmitters).set({ is2faEnabled: true, totpSecret: secret }).where(eq(transmitters.id, userId));

    const badCode = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { code: '000000' },
    });
    expect(badCode.statusCode).toBe(400);

    const validCode = generateCurrentTotpCode(secret);
    expect(verifyTotpToken(secret, validCode)).toBe(true);

    const disableRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { code: validCode },
    });
    expect(disableRes.statusCode).toBe(200);

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(meRes.json().transmitter.is2faEnabled).toBe(false);
  });

  it('GET /auth/me exposes is2faEnabled, createdAt, and profile fields', async () => {
    if (!(app as any).db) return;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.statusCode).toBe(200);
    const t = res.json().transmitter;
    expect(t).toHaveProperty('is2faEnabled');
    expect(t).toHaveProperty('createdAt');
    expect(t).toHaveProperty('customStatus');
    expect(t).toHaveProperty('profileVisibility');
    expect(t).not.toHaveProperty('passwordHash');
  });

  it('rate limits the login route: 429 after too many attempts for one account', async () => {
    if (!(app as any).db || !(app as any).redis) return;
    let sawTooManyRequests = false;
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'rate_limit_probe_account', password: 'wrong-password' },
      });
      if (res.statusCode === 429) {
        sawTooManyRequests = true;
        break;
      }
    }
    expect(sawTooManyRequests).toBe(true);
  });
});
