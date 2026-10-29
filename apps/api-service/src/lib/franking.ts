import crypto from 'node:crypto';

/**
 * Message franking, server side: checks a reporter's revealed contents of an encrypted
 * transmission against the commitment its sender stored (packages/e2ee has the client half
 * and the reasoning). The bytes covered must match frankingInput there exactly.
 */

export const FRANKING_KEY_BYTES = 32;
export const COMMITMENT_PATTERN = '^[A-Za-z0-9_-]{43}$';

export interface RevealedAttachment {
  url: string;
  key: string;
  filename: string;
  mimeType: string;
  size: number;
}

export function frankingInput(text: string, attachments: ReadonlyArray<RevealedAttachment> = []): Buffer {
  return Buffer.from(JSON.stringify(['subspace-franking-v1', text, attachments.map((a) => [a.url, a.key, a.filename, a.mimeType, a.size])]), 'utf8');
}

export function frankingCommitment(keyB64: string, text: string, attachments?: ReadonlyArray<RevealedAttachment>): string | null {
  const key = Buffer.from(keyB64, 'base64url');
  if (key.length !== FRANKING_KEY_BYTES || key.toString('base64url') !== keyB64) return null;
  return crypto.createHmac('sha256', key).update(frankingInput(text, attachments)).digest('base64url');
}

/** Whether revealed contents and key open the stored commitment (constant time). */
export function opensCommitment(commitment: string, keyB64: string, text: string, attachments?: ReadonlyArray<RevealedAttachment>): boolean {
  const expected = frankingCommitment(keyB64, text, attachments);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(commitment);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The commitment inside a stored encrypted payload, if its sender gave one. */
export function storedCommitment(encryptedPayload: string | null): string | null {
  if (!encryptedPayload) return null;
  try {
    const c = JSON.parse(encryptedPayload).commitment;
    return typeof c === 'string' && new RegExp(COMMITMENT_PATTERN).test(c) ? c : null;
  } catch {
    return null;
  }
}
