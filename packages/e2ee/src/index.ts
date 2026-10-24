/**
 * Subspace end-to-end encryption: X3DH key agreement and the Double Ratchet, after the Signal
 * specifications (signal.org/docs), on WebCrypto only so the same code runs in browsers and
 * Node. Curves and primitives: ECDH/ECDSA P-256, HKDF-SHA-256, HMAC-SHA-256, AES-256-GCM.
 *
 * The server only ever sees public keys and ciphertext. Private keys may be non-extractable
 * CryptoKeys (they are stored as such in IndexedDB by the web client).
 */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Array<ArrayBuffer | Uint8Array>) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** Key pairs keep their private half non-extractable; public halves are always exportable. */
export const newDhPair = () => subtle.generateKey(ECDH, false, ['deriveBits']) as Promise<CryptoKeyPair>;
const newSigningPair = () => subtle.generateKey(ECDSA, false, ['sign', 'verify']) as Promise<CryptoKeyPair>;

export const exportPublic = async (key: CryptoKey) => toB64(await subtle.exportKey('raw', key));
const importDhPublic = (b64: string) => subtle.importKey('raw', fromB64(b64), ECDH, true, []);
const importSigningPublic = (b64: string) => subtle.importKey('raw', fromB64(b64), ECDSA, true, ['verify']);

async function dh(priv: CryptoKey, pubB64: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importDhPublic(pubB64) }, priv, 256));
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', ikm as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, info: enc.encode(info) }, key, bytes * 8));
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey('raw', key as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data as Uint8Array<ArrayBuffer>));
}

async function aeadEncrypt(keyMaterial: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): Promise<Uint8Array> {
  const okm = await hkdf(keyMaterial, new Uint8Array(32), 'SubspaceMessageKeys', 44);
  const key = await subtle.importKey('raw', okm.slice(0, 32), 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: okm.slice(32, 44), additionalData: ad as Uint8Array<ArrayBuffer> }, key, plaintext as Uint8Array<ArrayBuffer>));
}

async function aeadDecrypt(keyMaterial: Uint8Array, ciphertext: Uint8Array, ad: Uint8Array): Promise<Uint8Array> {
  const okm = await hkdf(keyMaterial, new Uint8Array(32), 'SubspaceMessageKeys', 44);
  const key = await subtle.importKey('raw', okm.slice(0, 32), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: okm.slice(32, 44), additionalData: ad as Uint8Array<ArrayBuffer> }, key, ciphertext as Uint8Array<ArrayBuffer>));
}

// ---------------------------------------------------------------------------
// Device keys and prekey bundles
// ---------------------------------------------------------------------------

export interface PreKeyPair {
  id: number;
  pair: CryptoKeyPair;
}

/** Everything a device keeps private. */
export interface DeviceKeys {
  identity: CryptoKeyPair; // ECDH, used in X3DH
  signing: CryptoKeyPair; // ECDSA, signs the signed prekey
  signedPreKey: PreKeyPair & { signature: string };
  oneTimePreKeys: PreKeyPair[];
  nextPreKeyId: number;
}

/** What a device publishes. */
export interface PublicBundle {
  identityKey: string;
  signingKey: string;
  signedPreKey: { id: number; key: string; signature: string };
  oneTimePreKeys: Array<{ id: number; key: string }>;
}

/** A bundle as fetched for starting a session (at most one one-time prekey, claimed for us). */
export interface SessionBundle {
  deviceId: string;
  identityKey: string;
  signingKey: string;
  signedPreKey: { id: number; key: string; signature: string };
  oneTimePreKey: { id: number; key: string } | null;
}

export async function generateOneTimePreKeys(keys: DeviceKeys, count: number): Promise<PreKeyPair[]> {
  const fresh: PreKeyPair[] = [];
  for (let i = 0; i < count; i++) fresh.push({ id: keys.nextPreKeyId++, pair: await newDhPair() });
  keys.oneTimePreKeys.push(...fresh);
  return fresh;
}

export async function generateDeviceKeys(oneTimeCount = 20): Promise<DeviceKeys> {
  const identity = await newDhPair();
  const signing = await newSigningPair();
  const spk = await newDhPair();
  const spkPublic = await subtle.exportKey('raw', spk.publicKey);
  const signature = toB64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing.privateKey, spkPublic));
  const keys: DeviceKeys = { identity, signing, signedPreKey: { id: 1, pair: spk, signature }, oneTimePreKeys: [], nextPreKeyId: 1 };
  await generateOneTimePreKeys(keys, oneTimeCount);
  return keys;
}

export async function publicBundle(keys: DeviceKeys, oneTimePreKeys = keys.oneTimePreKeys): Promise<PublicBundle> {
  return {
    identityKey: await exportPublic(keys.identity.publicKey),
    signingKey: await exportPublic(keys.signing.publicKey),
    signedPreKey: { id: keys.signedPreKey.id, key: await exportPublic(keys.signedPreKey.pair.publicKey), signature: keys.signedPreKey.signature },
    oneTimePreKeys: await Promise.all(oneTimePreKeys.map(async (p) => ({ id: p.id, key: await exportPublic(p.pair.publicKey) }))),
  };
}

/** The signed prekey must carry the device's signature, or the server could swap it. */
export async function verifyBundle(bundle: Pick<SessionBundle, 'signingKey' | 'signedPreKey'>): Promise<boolean> {
  try {
    return await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importSigningPublic(bundle.signingKey),
      fromB64(bundle.signedPreKey.signature),
      fromB64(bundle.signedPreKey.key)
    );
  } catch {
    return false;
  }
}

/**
 * A safety number for a device: 60 digits in groups of five, from its two public keys.
 * Both people see the same number for the same device; a different number means a different key.
 */
export async function fingerprint(identityKey: string, signingKey: string): Promise<string> {
  let digest = concat(fromB64(identityKey), fromB64(signingKey));
  for (let i = 0; i < 1024; i++) digest = new Uint8Array(await subtle.digest('SHA-512', concat(digest, fromB64(identityKey))));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const chunk = digest.slice(i * 5, i * 5 + 5);
    const n = chunk.reduce((acc, b) => acc * 256 + b, 0) % 100000;
    groups.push(String(n).padStart(5, '0'));
  }
  return groups.join(' ');
}

// ---------------------------------------------------------------------------
// Double Ratchet
// ---------------------------------------------------------------------------

const MAX_SKIP = 1000;

export interface Header {
  dh: string;
  pn: number;
  n: number;
}

export interface RatchetState {
  dhs: CryptoKeyPair;
  dhsPublic: string;
  dhr: string | null;
  rk: Uint8Array;
  cks: Uint8Array | null;
  ckr: Uint8Array | null;
  ns: number;
  nr: number;
  pn: number;
  /** Message keys for messages that have not arrived yet, by `${dh}:${n}`. */
  skipped: Record<string, Uint8Array>;
  /** Associated data binding both identities into every message. */
  ad: Uint8Array;
}

async function kdfRk(rk: Uint8Array, dhOut: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdf(dhOut, rk, 'SubspaceRatchet', 64);
  return [out.slice(0, 32), out.slice(32)];
}

async function kdfCk(ck: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  return [await hmac(ck, new Uint8Array([2])), await hmac(ck, new Uint8Array([1]))];
}

const headerBytes = (h: Header) => enc.encode(`${h.dh}.${h.pn}.${h.n}`);

/** Initiator side (Alice), right after X3DH: `theirRatchetKey` is Bob's signed prekey. */
export async function initSender(sk: Uint8Array, ad: Uint8Array, theirRatchetKey: string): Promise<RatchetState> {
  const dhs = await newDhPair();
  const [rk, cks] = await kdfRk(sk, await dh(dhs.privateKey, theirRatchetKey));
  return { dhs, dhsPublic: await exportPublic(dhs.publicKey), dhr: theirRatchetKey, rk, cks, ckr: null, ns: 0, nr: 0, pn: 0, skipped: {}, ad };
}

/** Responder side (Bob): his signed prekey pair is the first ratchet key. */
export async function initReceiver(sk: Uint8Array, ad: Uint8Array, ownRatchetPair: CryptoKeyPair): Promise<RatchetState> {
  return { dhs: ownRatchetPair, dhsPublic: await exportPublic(ownRatchetPair.publicKey), dhr: null, rk: sk, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, skipped: {}, ad };
}

export async function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array): Promise<{ header: Header; ciphertext: string }> {
  if (!state.cks) throw new Error('Session cannot send yet');
  const [cks, mk] = await kdfCk(state.cks);
  state.cks = cks;
  const header: Header = { dh: state.dhsPublic, pn: state.pn, n: state.ns };
  state.ns += 1;
  return { header, ciphertext: toB64(await aeadEncrypt(mk, plaintext, concat(state.ad, headerBytes(header)))) };
}

const cloneState = (s: RatchetState): RatchetState => ({
  ...s,
  rk: s.rk.slice(),
  cks: s.cks?.slice() ?? null,
  ckr: s.ckr?.slice() ?? null,
  skipped: { ...s.skipped },
});

async function skipKeys(state: RatchetState, until: number) {
  if (!state.ckr) return;
  if (state.nr + MAX_SKIP < until) throw new Error('Too many skipped messages');
  while (state.nr < until) {
    const [ckr, mk] = await kdfCk(state.ckr);
    state.ckr = ckr;
    state.skipped[`${state.dhr}:${state.nr}`] = mk;
    state.nr += 1;
  }
}

/**
 * Decrypt one message. Returns the plaintext and the next state; the state passed in is left
 * untouched, so a forged or corrupted message cannot damage the session.
 */
export async function ratchetDecrypt(current: RatchetState, header: Header, ciphertext: string): Promise<{ plaintext: Uint8Array; state: RatchetState }> {
  const state = cloneState(current);
  const ad = concat(state.ad, headerBytes(header));
  const ct = fromB64(ciphertext);
  const skippedKey = `${header.dh}:${header.n}`;
  const skipped = state.skipped[skippedKey];
  if (skipped) {
    delete state.skipped[skippedKey];
    return { plaintext: await aeadDecrypt(skipped, ct, ad), state };
  }
  if (header.dh !== state.dhr) {
    await skipKeys(state, header.pn);
    state.pn = state.ns;
    state.ns = 0;
    state.nr = 0;
    state.dhr = header.dh;
    [state.rk, state.ckr] = await kdfRk(state.rk, await dh(state.dhs.privateKey, state.dhr));
    state.dhs = await newDhPair();
    state.dhsPublic = await exportPublic(state.dhs.publicKey);
    [state.rk, state.cks] = await kdfRk(state.rk, await dh(state.dhs.privateKey, state.dhr));
  }
  await skipKeys(state, header.n);
  const [ckr, mk] = await kdfCk(state.ckr!);
  state.ckr = ckr;
  state.nr += 1;
  return { plaintext: await aeadDecrypt(mk, ct, ad), state };
}

// ---------------------------------------------------------------------------
// X3DH + sessions
// ---------------------------------------------------------------------------

/** Sent with every message until the other side answers, so they can build the session. */
export interface PreKeyHeader {
  ik: string; // sender identity key
  sk: string; // sender signing key (for safety numbers)
  ek: string; // ephemeral key
  spk: number; // which signed prekey was used
  opk: number | null; // which one-time prekey was used
}

export interface Envelope {
  v: 1;
  header: Header;
  prekey?: PreKeyHeader;
  ciphertext: string;
}

export interface Session {
  remoteDeviceId: string;
  remoteIdentityKey: string;
  remoteSigningKey: string;
  ratchet: RatchetState;
  /** Prekey header to repeat until the first reply arrives. */
  pendingPreKey: PreKeyHeader | null;
  /** For a session the other device started: the ephemeral key it used. */
  acceptedEk?: string;
}

/** Sessions kept per remote device, newest first (both sides may start one at once). */
export const MAX_SESSIONS = 3;

const X3DH_PAD = new Uint8Array(32).fill(0xff);

/** Start a session with another device from its prekey bundle (X3DH, initiator side). */
export async function startSession(own: DeviceKeys, bundle: SessionBundle): Promise<Session> {
  if (!(await verifyBundle(bundle))) throw new Error('The device’s signed prekey is not validly signed');
  const ek = await newDhPair();
  const dhs = [
    await dh(own.identity.privateKey, bundle.signedPreKey.key),
    await dh(ek.privateKey, bundle.identityKey),
    await dh(ek.privateKey, bundle.signedPreKey.key),
    ...(bundle.oneTimePreKey ? [await dh(ek.privateKey, bundle.oneTimePreKey.key)] : []),
  ];
  const sk = await hkdf(concat(X3DH_PAD, ...dhs), new Uint8Array(32), 'SubspaceX3DH', 32);
  const ownIk = await exportPublic(own.identity.publicKey);
  const ad = concat(fromB64(ownIk), fromB64(bundle.identityKey));
  return {
    remoteDeviceId: bundle.deviceId,
    remoteIdentityKey: bundle.identityKey,
    remoteSigningKey: bundle.signingKey,
    ratchet: await initSender(sk, ad, bundle.signedPreKey.key),
    pendingPreKey: {
      ik: ownIk,
      sk: await exportPublic(own.signing.publicKey),
      ek: await exportPublic(ek.publicKey),
      spk: bundle.signedPreKey.id,
      opk: bundle.oneTimePreKey?.id ?? null,
    },
  };
}

/** Accept a session someone started with us (X3DH, responder side). */
async function acceptSession(own: DeviceKeys, remoteDeviceId: string, prekey: PreKeyHeader): Promise<Session> {
  if (prekey.spk !== own.signedPreKey.id) throw new Error('Unknown signed prekey');
  const opk = prekey.opk === null ? null : own.oneTimePreKeys.find((p) => p.id === prekey.opk);
  if (prekey.opk !== null && !opk) throw new Error('One-time prekey already used');
  const dhs = [
    await dh(own.signedPreKey.pair.privateKey, prekey.ik),
    await dh(own.identity.privateKey, prekey.ek),
    await dh(own.signedPreKey.pair.privateKey, prekey.ek),
    ...(opk ? [await dh(opk.pair.privateKey, prekey.ek)] : []),
  ];
  const sk = await hkdf(concat(X3DH_PAD, ...dhs), new Uint8Array(32), 'SubspaceX3DH', 32);
  const ad = concat(fromB64(prekey.ik), fromB64(await exportPublic(own.identity.publicKey)));
  return {
    remoteDeviceId,
    remoteIdentityKey: prekey.ik,
    remoteSigningKey: prekey.sk,
    ratchet: await initReceiver(sk, ad, own.signedPreKey.pair),
    pendingPreKey: null,
    acceptedEk: prekey.ek,
  };
}

export async function encrypt(session: Session, plaintext: string | Uint8Array): Promise<Envelope> {
  const bytes = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const { header, ciphertext } = await ratchetEncrypt(session.ratchet, bytes);
  return { v: 1, header, ...(session.pendingPreKey ? { prekey: session.pendingPreKey } : {}), ciphertext };
}

/**
 * Decrypt an envelope from `remoteDeviceId`, given our sessions with that device (newest
 * first). A prekey envelope for a session we have not seen builds one; the one-time prekey it
 * used is deleted only once the message has decrypted. Returns the sessions to keep, with the
 * one that worked first. Nothing is changed when decryption fails.
 */
export async function decrypt(own: DeviceKeys, remoteDeviceId: string, sessions: Session[], envelope: Envelope): Promise<{ plaintext: Uint8Array; sessions: Session[] }> {
  if (envelope.v !== 1) throw new Error('Unsupported envelope version');
  const candidates: Array<{ session: Session; fresh: boolean }> = [];
  if (envelope.prekey) {
    const known = sessions.find((s) => s.acceptedEk === envelope.prekey!.ek);
    candidates.push(known ? { session: known, fresh: false } : { session: await acceptSession(own, remoteDeviceId, envelope.prekey), fresh: true });
  } else {
    candidates.push(...sessions.map((session) => ({ session, fresh: false })));
  }
  let lastError: unknown = new Error('No session with this device');
  for (const { session, fresh } of candidates) {
    try {
      const { plaintext, state } = await ratchetDecrypt(session.ratchet, envelope.header, envelope.ciphertext);
      if (fresh && envelope.prekey?.opk !== null) own.oneTimePreKeys = own.oneTimePreKeys.filter((p) => p.id !== envelope.prekey!.opk);
      // Any message from them means they have this session: stop sending the prekey header.
      const updated: Session = { ...session, ratchet: state, pendingPreKey: null };
      return { plaintext, sessions: [updated, ...sessions.filter((s) => s !== session)].slice(0, MAX_SESSIONS) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export const decodeText = (bytes: Uint8Array) => dec.decode(bytes);

// ---------------------------------------------------------------------------
// Symmetric helpers (attachments, call frame keys, the sender's own copy)
// ---------------------------------------------------------------------------

export const randomKey = () => toB64(randomBytes(32));

/** AES-256-GCM with a random nonce; output is nonce || ciphertext. */
export async function sealWithKey(keyB64: string, data: Uint8Array, ad = new Uint8Array()): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const key = await subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['encrypt']);
  return concat(iv, await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad as Uint8Array<ArrayBuffer> }, key, data as Uint8Array<ArrayBuffer>));
}

export async function openWithKey(keyB64: string, sealed: Uint8Array, ad = new Uint8Array()): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: ad as Uint8Array<ArrayBuffer> }, key, sealed.slice(12)));
}
