// Security tests for verifyInteraction / verifyInteractionAsync: Ed25519 over timestamp + raw body,
// hex signature (X-Signature-Ed25519) and hex public key, timestamp from X-Signature-Timestamp.
// The SDK has no request-parsing helper; callers pass header values, so a missing header is
// undefined / null / '' here.
//   deno test --allow-net --allow-read --allow-env deno/
import { assert } from './assert.ts';
import { verifyInteraction, verifyInteractionAsync } from '../src/index.ts';

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const now = () => String(Math.floor(Date.now() / 1000));
const BODY = '{"type":2,"id":"1","data":{"name":"ping"}}';
// Order of the Ed25519 base point (RFC 8032).
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const IDENTITY = '01' + '00'.repeat(31); // the neutral point: small order (order 1)

async function keyPair() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKeyHex = toHex(await crypto.subtle.exportKey('raw', kp.publicKey));
  const sign = async (msg: string) => toHex(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(msg)));
  return { publicKeyHex, sign };
}
const A = await keyPair();
const B = await keyPair();

type Args = [unknown, unknown, unknown, unknown];
/** Both verifiers, as `true` / `false` / 'threw: ...' so a crash is never mistaken for a refusal. */
async function both(...args: Args): Promise<[unknown, unknown]> {
  let s: unknown, a: unknown;
  // deno-lint-ignore no-explicit-any
  try { s = (verifyInteraction as any)(...args); } catch (e) { s = `threw: ${e}`; }
  // deno-lint-ignore no-explicit-any
  try { a = await (verifyInteractionAsync as any)(...args); } catch (e) { a = `threw: ${e}`; }
  return [s, a];
}
async function refused(what: string, ...args: Args) {
  const [s, a] = await both(...args);
  assert(s === false, `${what}: verifyInteraction returned ${s}`);
  assert(a === false, `${what}: verifyInteractionAsync returned ${a}`);
}
async function accepted(what: string, ...args: Args) {
  const [s, a] = await both(...args);
  assert(s === true, `${what}: verifyInteraction returned ${s}`);
  assert(a === true, `${what}: verifyInteractionAsync returned ${a}`);
}

async function good() {
  const ts = now();
  return { ts, sig: await A.sign(ts + BODY) };
}

// ---- baseline and tampering --------------------------------------------------------------

Deno.test('security: a valid signature passes (baseline)', async () => {
  const { ts, sig } = await good();
  await accepted('valid', BODY, sig, ts, A.publicKeyHex);
});

Deno.test('security: tampered body and timestamp are refused', async () => {
  const { ts, sig } = await good();
  await refused('body changed', BODY.replace('ping', 'pong'), sig, ts, A.publicKeyHex);
  await refused('body + space', BODY + ' ', sig, ts, A.publicKeyHex);
  await refused('body truncated', BODY.slice(0, -1), sig, ts, A.publicKeyHex);
  await refused('empty body', '', sig, ts, A.publicKeyHex);
  await refused('ts - 1', BODY, sig, String(Number(ts) - 1), A.publicKeyHex);
  await refused('ts with leading zero', BODY, sig, '0' + ts, A.publicKeyHex);
});

Deno.test('security: moving a digit from the body onto the timestamp is refused by freshness', async () => {
  // timestamp + body is a plain concatenation: these two requests sign the same bytes.
  const ts = now();
  const sig = await A.sign(ts + '7' + BODY);
  await accepted('original', '7' + BODY, sig, ts, A.publicKeyHex);
  await refused('shifted', BODY, sig, ts + '7', A.publicKeyHex);
});

Deno.test('security: a signature of a different message or key is refused', async () => {
  const ts = now();
  await refused('other message', BODY, await A.sign(ts + '{"type":1}'), ts, A.publicKeyHex);
  await refused('other key signed', BODY, await B.sign(ts + BODY), ts, A.publicKeyHex);
  await refused('checked against other key', BODY, await A.sign(ts + BODY), ts, B.publicKeyHex);
});

// ---- signature encoding --------------------------------------------------------------------

Deno.test('security: wrong-length signatures are refused', async () => {
  const { ts, sig } = await good();
  for (const n of [0, 1, 32, 63, 65, 128]) await refused(`${n} bytes`, BODY, sig.repeat(3).slice(0, n * 2), ts, A.publicKeyHex);
});

Deno.test('security: non-hex signatures are refused', async () => {
  const { ts, sig } = await good();
  const bad: Record<string, string> = {
    zz: 'zz',
    'zz prefix': 'zz' + sig.slice(2),
    'odd short': sig.slice(0, -1),
    'odd long': sig + '0',
    '0x same length': '0x' + sig.slice(2),
    '0x prefix': '0x' + sig,
    'leading space': ' ' + sig,
    'trailing newline': sig + '\n',
    'spaced bytes': sig.match(/../g)!.join(' '),
    dash: sig.slice(0, 64) + '-' + sig.slice(65),
    'arabic digits': '٠'.repeat(128),
  };
  for (const [what, s] of Object.entries(bad)) await refused(what, BODY, s, ts, A.publicKeyHex);
});

Deno.test('security: uppercase hex signature is accepted (behaviour note)', async () => {
  // fromHex accepts [0-9a-fA-F]; the bytes are the same signature, so this is not a forgery.
  const { ts, sig } = await good();
  await accepted('uppercase', BODY, sig.toUpperCase(), ts, A.publicKeyHex);
});

// ---- public key ---------------------------------------------------------------------------

Deno.test('security: wrong-length and non-hex public keys are refused', async () => {
  const { ts, sig } = await good();
  const k = A.publicKeyHex;
  const bad = ['', '00', k.slice(0, -2), k + '00', k.slice(0, -1), 'zz'.repeat(32), '0x' + k.slice(2), 'not hex', ' ' + k, '00'.repeat(32)];
  for (const key of bad) await refused(`key ${JSON.stringify(key)}`, BODY, sig, ts, key);
});

// ---- empty / missing / wrong-typed values ------------------------------------------------------

Deno.test('security: empty values and missing headers are refused without throwing', async () => {
  const { ts, sig } = await good();
  const k = A.publicKeyHex;
  await refused('empty signature', BODY, '', ts, k);
  await refused('empty timestamp', BODY, sig, '', k);
  await refused('empty key', BODY, sig, ts, '');
  await refused('all empty', '', '', '', '');
  await refused('undefined signature', BODY, undefined, ts, k);
  await refused('null signature', BODY, null, ts, k);
  await refused('undefined timestamp', BODY, sig, undefined, k);
  await refused('null timestamp', BODY, sig, null, k);
  await refused('undefined key', BODY, sig, ts, undefined);
  await refused('null key', BODY, sig, ts, null);
  await refused('undefined body', undefined, sig, ts, k);
  await refused('null body', null, sig, ts, k);
  await refused('all undefined', undefined, undefined, undefined, undefined);
  await refused('object signature', BODY, { length: 128 }, ts, k);
  // Duplicate headers given as an array: ['a', 'b'] joins to 'a,b' and fails the digit check.
  await refused('two timestamp headers', BODY, sig, [ts, ts], k);
  await refused('two signature headers', BODY, [sig, sig], ts, k);
});

// ---- timestamp freshness (implemented: 300 s either way) ------------------------------------------

Deno.test('security: stale, future and non-numeric timestamps are refused', async () => {
  const t = Math.floor(Date.now() / 1000);
  for (const d of [-301, 301, -86400, 1e9]) {
    const ts = String(t + d);
    await refused(`ts ${d}`, BODY, await A.sign(ts + BODY), ts, A.publicKeyHex);
  }
  for (const d of [-200, 200]) {
    const ts = String(t + d);
    await accepted(`ts ${d}`, BODY, await A.sign(ts + BODY), ts, A.publicKeyHex);
  }
  for (const ts of ['abc', '-1', '+1', '1.5', '1e9', ' 1', '0x10', '١٧', '9'.repeat(5000)]) {
    await refused(`ts ${JSON.stringify(ts.slice(0, 12))}`, BODY, await A.sign(ts + BODY), ts, A.publicKeyHex);
  }
});

// ---- malleability and small-order points -------------------------------------------------------

Deno.test('security: non-canonical S (S + L) is refused', async () => {
  const { ts, sig } = await good();
  const bytes = fromHex(sig);
  let s = 0n;
  for (let i = 63; i >= 32; i--) s = (s << 8n) | BigInt(bytes[i]);
  assert(s < L, 'fresh signature has canonical S');
  const withS = (v: bigint) => {
    const out = bytes.slice();
    for (let i = 32; i < 64; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return toHex(out);
  };
  await refused('S + L', BODY, withS(s + L), ts, A.publicKeyHex);
  await refused('S = L', BODY, withS(L), ts, A.publicKeyHex);
  await refused('S = 2^256 - 1', BODY, withS((1n << 256n) - 1n), ts, A.publicKeyHex);
});

Deno.test('security: all-zero / all-ff signatures and identity R are refused', async () => {
  const { ts } = await good();
  await refused('all zero', BODY, '00'.repeat(64), ts, A.publicKeyHex);
  await refused('all ff', BODY, 'ff'.repeat(64), ts, A.publicKeyHex);
  await refused('identity R, S = 0', BODY, IDENTITY + '00'.repeat(32), ts, A.publicKeyHex);
});

// Fixed (was a security bug): OpenSSL and WebCrypto accept the small-order identity point as a
// public key; with A = identity, R = identity and S = 0 any message verifies. The SDK refuses
// small-order public keys and R before verifying.
Deno.test('security: small-order (identity) public key is refused', async () => {
  const ts = now();
  for (const body of [BODY, 'anything at all']) await refused(`identity key, ${body}`, body, IDENTITY + '00'.repeat(32), ts, IDENTITY);
});
