import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotpToken,
  generateBackupCodes,
  verifyBackupCode,
  signAccessToken,
  verifyToken,
  TokenPayload,
} from '@subspace/crypto';

describe('@subspace/crypto Suite', () => {
  it('hashes and verifies passwords securely using Argon2id', async () => {
    const password = 'SubspacePassword#2026!';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash.startsWith('$argon2id$')).toBe(true);

    const isValid = await verifyPassword(hash, password);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword(hash, 'WrongPassword');
    expect(isInvalid).toBe(false);
  });

  it('generates and validates TOTP 2FA tokens', () => {
    const { secret, uri } = generateTotpSecret('Subspace Frequency', 'commander_spock');
    expect(secret).toBeDefined();
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('commander_spock');

    // Generate a valid token using otpauth library
    const OTPAuth = require('otpauth');
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const currentToken = totp.generate();

    const isValid = verifyTotpToken(secret, currentToken);
    expect(isValid).toBe(true);

    const isInvalid = verifyTotpToken(secret, '000000');
    expect(isInvalid).toBe(false);
  });

  it('generates and redeems single-use backup codes', () => {
    const { plainCodes, hashedCodes } = generateBackupCodes(5);
    expect(plainCodes.length).toBe(5);
    expect(hashedCodes.length).toBe(5);

    const codeToRedeem = plainCodes[2];
    const { valid, remaining } = verifyBackupCode(codeToRedeem, hashedCodes);

    expect(valid).toBe(true);
    expect(remaining.length).toBe(4);

    // Redeeming the same code again fails
    const secondAttempt = verifyBackupCode(codeToRedeem, remaining);
    expect(secondAttempt.valid).toBe(false);
  });

  it('signs and verifies JWT access tokens', () => {
    const secret = 'jwt_test_secret_2026';
    const payload: TokenPayload = {
      transmitterId: '713694467282698241',
      username: 'navigator_chekov',
      staffRank: 2,
    };

    const token = signAccessToken(payload, secret, '1h');
    const decoded = verifyToken<TokenPayload>(token, secret);

    expect(decoded).toBeDefined();
    expect(decoded?.transmitterId).toBe(payload.transmitterId);
    expect(decoded?.username).toBe(payload.username);
    expect(decoded?.staffRank).toBe(payload.staffRank);
  });
});
