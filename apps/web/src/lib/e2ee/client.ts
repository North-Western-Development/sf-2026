import {
  generateDeviceKeys,
  generateOneTimePreKeys,
  publicBundle,
  startSession,
  encrypt,
  decrypt,
  decodeText,
  fingerprint,
  sealWithKey,
  openWithKey,
  randomKey,
  toB64,
  fromB64,
  type Envelope,
  type SessionBundle,
} from '@subspace/e2ee';
import { http, ApiError } from '../http';
import { getDevice, putDevice, deleteDevice, getSessions, putSessions, getPlain, putPlain, type DeviceRecord, type Plain } from './keystore';

/** The ciphertext a transmission carries in an encrypted link (see ENCRYPTED_PAYLOAD on the API). */
export interface EncryptedPayload {
  v: 1;
  senderDevice: string;
  envelopes: Record<string, Envelope>;
  self?: string;
}

interface RemoteDevice {
  id: string;
  name: string;
  identityKey: string;
  signingKey: string;
}

const PREKEY_TARGET = 50;
const PREKEY_LOW = 20;
export const e2eeSupported = () => typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle;

// Every operation that reads and writes keys or sessions runs one at a time, in order.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

let current: { userId: string; record: Promise<DeviceRecord | null> } | null = null;

/**
 * This browser's encryption device for the signed-in user: created and registered on first
 * use, re-registered if the server forgot it, and kept stocked with one-time prekeys.
 */
export function ensureDevice(userId: string): Promise<DeviceRecord | null> {
  if (!e2eeSupported()) return Promise.resolve(null);
  if (current?.userId === userId) return current.record;
  const record = serial(async () => {
    let rec = await getDevice(userId);
    if (rec) {
      try {
        const { remaining } = await http.get<{ remaining: number }>(`/e2ee/devices/${rec.deviceId}/prekeys`);
        if (remaining < PREKEY_LOW) {
          const fresh = await generateOneTimePreKeys(rec.keys, PREKEY_TARGET - remaining);
          await http.post(`/e2ee/devices/${rec.deviceId}/prekeys`, { oneTimePreKeys: (await publicBundle(rec.keys, fresh)).oneTimePreKeys });
          await putDevice(rec);
        }
        return rec;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
        await deleteDevice(userId); // the server no longer knows this device: start over
      }
    }
    const keys = await generateDeviceKeys(PREKEY_TARGET);
    const { device } = await http.post<{ device: { id: string } }>('/e2ee/devices', { name: deviceName(), ...(await publicBundle(keys)) });
    rec = { userId, deviceId: device.id, keys, selfKey: randomKey() };
    await putDevice(rec);
    return rec;
  }).catch(() => null);
  current = { userId, record };
  return record;
}

export function forgetDevice() {
  current = null;
}

function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const deviceCache = new Map<string, { at: number; devices: RemoteDevice[] }>();
async function devicesOf(userId: string, fresh = false): Promise<RemoteDevice[]> {
  const hit = deviceCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.devices;
  const { devices } = await http.get<{ devices: RemoteDevice[] }>(`/e2ee/users/${userId}/devices`);
  deviceCache.set(userId, { at: Date.now(), devices });
  return devices;
}

/** Encrypt one payload for every device of the recipients and every other device of mine. */
export async function encryptPayload(myId: string, recipientIds: string[], plain: Plain): Promise<EncryptedPayload> {
  const rec = await ensureDevice(myId);
  if (!rec) throw new Error('This browser is not set up for encryption');
  return serial(async () => {
    const body = JSON.stringify(plain);
    const theirs = (await Promise.all(recipientIds.map((id) => devicesOf(id, true)))).flat();
    if (recipientIds.length && !theirs.length) throw new Error('They have no device that can receive encrypted transmissions');
    const mine = (await devicesOf(myId, true)).filter((d) => d.id !== rec.deviceId);
    const targets = [...theirs, ...mine];
    const envelopes: Record<string, Envelope> = {};
    for (const device of targets) {
      let sessions = await getSessions(myId, device.id);
      if (!sessions.length || sessions[0].remoteIdentityKey !== device.identityKey) {
        const { bundle } = await http.post<{ bundle: SessionBundle }>(`/e2ee/devices/${device.id}/bundle`);
        sessions = [await startSession(rec.keys, bundle), ...sessions];
      }
      envelopes[device.id] = await encrypt(sessions[0], body);
      await putSessions(myId, device.id, sessions);
    }
    const self = toB64(await sealWithKey(rec.selfKey, new TextEncoder().encode(body)));
    return { v: 1, senderDevice: rec.deviceId, envelopes, self };
  });
}

export type DecryptResult = { ok: true; plain: Plain } | { ok: false; reason: 'other-device' | 'failed' };

/**
 * Open an encrypted transmission. Plaintext is cached by transmission id (and edit time), so
 * history stays readable after the ratchet keys are gone.
 */
export async function decryptTransmission(myId: string, messageId: string, authorId: string, payload: EncryptedPayload, version = ''): Promise<DecryptResult> {
  const cacheKey = version ? `${messageId}@${version}` : messageId;
  const cached = await getPlain(cacheKey);
  if (cached) return { ok: true, plain: cached };
  // Set up (or load) the device first: queued jobs must never wait on later ones.
  const rec = await ensureDevice(myId);
  if (!rec) return { ok: false, reason: 'other-device' };
  return serial(async () => {
    const again = await getPlain(cacheKey);
    if (again) return { ok: true as const, plain: again };
    let body: string;
    try {
      if (payload.senderDevice === rec.deviceId && authorId === myId) {
        if (!payload.self) return { ok: false as const, reason: 'failed' as const };
        body = decodeText(await openWithKey(rec.selfKey, fromB64(payload.self)));
      } else {
        const envelope = payload.envelopes[rec.deviceId];
        if (!envelope) return { ok: false as const, reason: 'other-device' as const };
        const out = await decrypt(rec.keys, payload.senderDevice, await getSessions(myId, payload.senderDevice), envelope);
        await putSessions(myId, payload.senderDevice, out.sessions);
        await putDevice(rec); // a one-time prekey may have been used up
        body = decodeText(out.plaintext);
      }
    } catch {
      return { ok: false as const, reason: 'failed' as const };
    }
    const plain = JSON.parse(body) as Plain;
    await putPlain(cacheKey, plain);
    return { ok: true as const, plain };
  });
}

/** Remember what this device sent, under the id the server gave it. */
export const rememberSent = (messageId: string, plain: Plain, version = '') => putPlain(version ? `${messageId}@${version}` : messageId, plain);

/** Safety numbers: this device's, and every device of another person. */
export async function safetyNumbers(myId: string, otherId: string) {
  const rec = await ensureDevice(myId);
  const mine = rec ? await fingerprint(toB64(await crypto.subtle.exportKey('raw', rec.keys.identity.publicKey)), toB64(await crypto.subtle.exportKey('raw', rec.keys.signing.publicKey))) : null;
  const theirs = await Promise.all((await devicesOf(otherId, true)).map(async (d) => ({ name: d.name, number: await fingerprint(d.identityKey, d.signingKey) })));
  return { mine, theirs };
}

// ---------------------------------------------------------------------------
// Encrypted attachments: the file is sealed on the device; the vault keeps ciphertext.
// ---------------------------------------------------------------------------

export async function sealFile(file: File): Promise<{ blob: Blob; key: string }> {
  const key = randomKey();
  const sealed = await sealWithKey(key, new Uint8Array(await file.arrayBuffer()));
  return { blob: new Blob([sealed as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), key };
}

const opened = new Map<string, Promise<string>>();
/** Download, decrypt and expose an encrypted attachment as an object URL (cached per URL). */
export function openFile(url: string, key: string, mimeType: string): Promise<string> {
  if (!opened.has(url)) {
    opened.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`Download failed (${r.status})`);
          return r.arrayBuffer();
        })
        .then((buf) => openWithKey(key, new Uint8Array(buf)))
        .then((bytes) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType })))
    );
    opened.get(url)!.catch(() => opened.delete(url));
  }
  return opened.get(url)!;
}
