import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  signTwoFactorChallengeToken,
  verifyAccessToken,
  verifyTypedToken,
  signJwt,
  requireSecret,
} from '@subspace/crypto';

const SECRET = 'unit_test_secret';
const payload = { transmitterId: 't-1', username: 'kira', staffRank: 0 };

describe('Typed session tokens', () => {
  it('accepts access tokens as access tokens', () => {
    expect(verifyAccessToken(signAccessToken(payload, SECRET), SECRET)?.transmitterId).toBe('t-1');
  });

  it('rejects refresh tokens where an access token is required', () => {
    expect(verifyAccessToken(signRefreshToken('t-1', SECRET), SECRET)).toBeNull();
  });

  it('rejects 2FA challenge tickets where an access token is required (no 2FA bypass)', () => {
    expect(verifyAccessToken(signTwoFactorChallengeToken('t-1', SECRET), SECRET)).toBeNull();
  });

  it('rejects untyped legacy tokens', () => {
    expect(verifyAccessToken(signJwt(payload, SECRET), SECRET)).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    expect(verifyAccessToken(signAccessToken(payload, 'other'), SECRET)).toBeNull();
  });

  it('rejects alg=none tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, typ: 'access' })).toString('base64url');
    expect(verifyAccessToken(`${header}.${body}.`, SECRET)).toBeNull();
  });

  it('refresh tokens carry a jti and only verify as refresh', () => {
    const t = signRefreshToken('t-1', SECRET, '1d', 'abc');
    expect(verifyTypedToken(t, SECRET, 'refresh')?.jti).toBe('abc');
    expect(verifyTypedToken(t, SECRET, '2fa_challenge')).toBeNull();
  });

  it('access tokens ignore smuggled typ claims in the payload', () => {
    const t = signAccessToken({ ...payload, typ: 'refresh' } as any, SECRET);
    expect(verifyTypedToken(t, SECRET, 'refresh')).toBeNull();
  });
});

describe('requireSecret', () => {
  it('refuses development defaults in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.__SUBSPACE_TEST_SECRET;
    expect(() => requireSecret('__SUBSPACE_TEST_SECRET', 'dev')).toThrow(/Missing required secret/);
    process.env.NODE_ENV = prev;
  });

  it('falls back outside production', () => {
    expect(requireSecret('__SUBSPACE_TEST_SECRET', 'dev')).toBe('dev');
  });
});
