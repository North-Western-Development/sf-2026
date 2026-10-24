import { randomBytes } from 'node:crypto';
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

/** Computes the current valid TOTP code for a base32 secret (test/debug helper). */
export function generateCurrentTotpCode(secret: string): string {
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.generate();
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
  /** Device session this token belongs to; revoking the session invalidates the token. */
  sid?: string;
}

/**
 * Every token carries a `typ` claim so each kind is only accepted where it belongs:
 * a refresh token or 2FA challenge can never be replayed as an access token.
 */
export type TokenType = 'access' | 'refresh' | '2fa_challenge';

export function signAccessToken(payload: TokenPayload, secret: string, expiresIn: jwt.SignOptions['expiresIn'] = '15m'): string {
  const { transmitterId, username, staffRank, sid } = payload;
  return jwt.sign({ transmitterId, username, staffRank, ...(sid ? { sid } : {}), typ: 'access' }, secret, { expiresIn });
}

export function signRefreshToken(
  transmitterId: string,
  secret: string,
  expiresIn: jwt.SignOptions['expiresIn'] = '30d',
  jti: string = randomBytes(16).toString('hex'),
  tokenVersion: number = 0
): string {
  return jwt.sign({ transmitterId, typ: 'refresh', jti, tokenVersion }, secret, { expiresIn });
}

/** Short-lived ticket proving the password step passed; only redeemable at /auth/2fa/verify. */
export function signTwoFactorChallengeToken(transmitterId: string, secret: string): string {
  return jwt.sign({ transmitterId, typ: '2fa_challenge' }, secret, { expiresIn: '5m' });
}

/** Low-level verification. Prefer verifyAccessToken / verifyTypedToken. */
export function verifyToken<T>(token: string, secret: string): T | null {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as T;
  } catch {
    return null;
  }
}

export function verifyTypedToken<T extends object>(
  token: string,
  secret: string,
  typ: TokenType
): (T & { typ: TokenType; exp?: number; jti?: string }) | null {
  const decoded = verifyToken<any>(token, secret);
  if (!decoded || typeof decoded !== 'object' || decoded.typ !== typ) return null;
  return decoded;
}

export function verifyAccessToken(token: string, secret: string): TokenPayload | null {
  return verifyTypedToken<TokenPayload>(token, secret, 'access');
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

/**
 * Reads a secret from the environment. In production a missing value is fatal so that
 * deployments can never silently run on the well-known development defaults.
 */
export function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`[Subspace] Missing required secret ${name}; refusing to start with a development default`);
  }
  return devFallback;
}

export const DEV_JWT_SECRET = 'subspace_jwt_super_secret_key_2026';
export function getJwtSecret(): string {
  return requireSecret('JWT_SECRET', DEV_JWT_SECRET);
}
