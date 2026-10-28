import crypto from 'node:crypto';

/**
 * Web Push message encryption (RFC 8291, aes128gcm content coding), which UnifiedPush uses.
 * Only the receiving install holds the private key, so the push server in between (ntfy, or
 * whichever distributor the phone picked) relays ciphertext it cannot read.
 */

const b64url = (s: string) => Buffer.from(s, 'base64url');
const hmac = (key: Buffer, data: Buffer) => crypto.createHmac('sha256', key).update(data).digest();
/** HKDF-Expand for a single block (all lengths here are at most 32 bytes). */
const expand = (prk: Buffer, info: Buffer, length: number) => hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

/** A receiver's keys as the app reports them: 65-byte uncompressed P-256 point and 16-byte secret. */
export function validKeys(p256dh: string, auth: string) {
  const pub = b64url(p256dh);
  return pub.length === 65 && pub[0] === 4 && b64url(auth).length === 16;
}

/**
 * Encrypt one record for a receiver. `salt` and `senderKey` are for the RFC's test vector only;
 * every real message gets fresh ones.
 */
export function encryptWebPush(plaintext: Buffer, p256dh: string, auth: string, fixed?: { salt: Buffer; senderKey: Buffer }): Buffer {
  const uaPublic = b64url(p256dh);
  const authSecret = b64url(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.senderKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = fixed?.salt ?? crypto.randomBytes(16);

  const ikm = expand(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // A single record: the content, then the 0x02 delimiter that marks the last one.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}
