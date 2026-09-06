import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

/**
 * Password Hashing with Argon2id
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Two-Factor Authentication (TOTP)
 */
export function generateTotpSecret(issuer: string, label: string) {
  const totp = new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  return {
    secret: totp.secret.base32,
    uri: totp.toString(),
  };
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export function generateBackupCodes(count = 10): { plainCodes: string[]; hashedCodes: string[] } {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 characters
    plainCodes.push(code);
    hashedCodes.push(crypto.createHash('sha256').update(code).digest('hex'));
  }

  return { plainCodes, hashedCodes };
}

export function verifyBackupCode(code: string, hashedCodes: string[]): { valid: boolean; remaining: string[] } {
  const targetHash = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  const index = hashedCodes.indexOf(targetHash);
  if (index === -1) {
    return { valid: false, remaining: hashedCodes };
  }

  const remaining = [...hashedCodes];
  remaining.splice(index, 1);
  return { valid: true, remaining };
}

/**
 * JWT Token Utilities
 */
export interface TokenPayload {
  transmitterId: string;
  username: string;
  staffRank: number;
}

export function signAccessToken(payload: TokenPayload, secret: string, expiresIn: jwt.SignOptions['expiresIn'] = '15m'): string {
  return jwt.sign(payload, secret, { expiresIn });
}

export function signRefreshToken(transmitterId: string, secret: string, expiresIn: jwt.SignOptions['expiresIn'] = '7d'): string {
  return jwt.sign({ transmitterId, type: 'refresh' }, secret, { expiresIn });
}

export function verifyToken<T>(token: string, secret: string): T | null {
  try {
    return jwt.verify(token, secret) as T;
  } catch {
    return null;
  }
}

export function signJwt(payload: string | object | Buffer, secret: string, options?: jwt.SignOptions): string {
  return jwt.sign(payload, secret, options);
}

export { jwt };

/**
 * Passkeys (SimpleWebAuthn)
 */
export const PasskeyManager = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};
