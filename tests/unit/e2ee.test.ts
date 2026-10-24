import { describe, it, expect } from 'vitest';
import {
  generateDeviceKeys,
  publicBundle,
  verifyBundle,
  startSession,
  encrypt,
  decrypt,
  decodeText,
  fingerprint,
  sealWithKey,
  openWithKey,
  randomKey,
  type DeviceKeys,
  type Session,
  type SessionBundle,
  type Envelope,
} from '@subspace/e2ee';

/** What the server hands out: the public bundle with one one-time prekey claimed. */
async function bundleFor(deviceId: string, keys: DeviceKeys, claim = true): Promise<SessionBundle> {
  const pub = await publicBundle(keys);
  return { deviceId, identityKey: pub.identityKey, signingKey: pub.signingKey, signedPreKey: pub.signedPreKey, oneTimePreKey: claim ? pub.oneTimePreKeys[0] : null };
}

/** A device and the sessions it holds, keyed by remote device id. */
function device(keys: DeviceKeys) {
  const sessions: Record<string, Session[]> = {};
  return {
    keys,
    sessions,
    async send(to: string, text: string) {
      return encrypt(sessions[to][0], text);
    },
    async receive(from: string, env: Envelope) {
      const out = await decrypt(keys, from, sessions[from] ?? [], env);
      sessions[from] = out.sessions;
      return decodeText(out.plaintext);
    },
  };
}

describe('E2EE: X3DH + Double Ratchet', () => {
  it('Alice encrypts to Bob, the payload is only ciphertext, Bob decrypts, Eve cannot', async () => {
    const alice = device(await generateDeviceKeys(5));
    const bob = device(await generateDeviceKeys(5));
    const eve = device(await generateDeviceKeys(5));
    alice.sessions.bob = [await startSession(alice.keys, await bundleFor('bob', bob.keys))];

    const env = await alice.send('bob', 'Rendezvous at the Horsehead Nebula');
    expect(JSON.stringify(env)).not.toContain('Horsehead');
    expect(env.prekey).toBeDefined();
    expect(await bob.receive('alice', env)).toBe('Rendezvous at the Horsehead Nebula');
    await expect(eve.receive('alice', env)).rejects.toThrow();
  });

  it('keeps talking in both directions, ratcheting keys, and drops the prekey header after a reply', async () => {
    const alice = device(await generateDeviceKeys(5));
    const bob = device(await generateDeviceKeys(5));
    alice.sessions.bob = [await startSession(alice.keys, await bundleFor('bob', bob.keys))];
    expect(await bob.receive('alice', await alice.send('bob', 'one'))).toBe('one');
    const second = await alice.send('bob', 'two');
    expect(second.prekey).toBeDefined(); // no reply yet
    expect(await bob.receive('alice', second)).toBe('two');

    const reply = await bob.send('alice', 'three');
    expect(reply.prekey).toBeUndefined();
    expect(await alice.receive('bob', reply)).toBe('three');
    const after = await alice.send('bob', 'four');
    expect(after.prekey).toBeUndefined();
    expect(after.header.dh).not.toBe(second.header.dh); // a DH ratchet step happened
    expect(await bob.receive('alice', after)).toBe('four');
  });

  it('decrypts out-of-order messages and refuses replays', async () => {
    const alice = device(await generateDeviceKeys(5));
    const bob = device(await generateDeviceKeys(5));
    alice.sessions.bob = [await startSession(alice.keys, await bundleFor('bob', bob.keys))];
    const m = [] as Envelope[];
    for (let i = 0; i < 5; i++) m.push(await alice.send('bob', `msg ${i}`));
    expect(await bob.receive('alice', m[0])).toBe('msg 0');
    expect(await bob.receive('alice', m[3])).toBe('msg 3');
    expect(await bob.receive('alice', m[1])).toBe('msg 1');
    expect(await bob.receive('alice', m[4])).toBe('msg 4');
    expect(await bob.receive('alice', m[2])).toBe('msg 2');
    await expect(bob.receive('alice', m[2])).rejects.toThrow();
  });

  it('a tampered message fails and leaves the session working', async () => {
    const alice = device(await generateDeviceKeys(5));
    const bob = device(await generateDeviceKeys(5));
    alice.sessions.bob = [await startSession(alice.keys, await bundleFor('bob', bob.keys))];
    expect(await bob.receive('alice', await alice.send('bob', 'hello'))).toBe('hello');
    const good = await alice.send('bob', 'intact');
    const flipped = { ...good, ciphertext: good.ciphertext.slice(0, -2) + (good.ciphertext.endsWith('A') ? 'BA' : 'AA') };
    await expect(bob.receive('alice', flipped)).rejects.toThrow();
    const forgedHeader = { ...good, header: { ...good.header, n: good.header.n + 1 } };
    await expect(bob.receive('alice', forgedHeader)).rejects.toThrow();
    expect(await bob.receive('alice', good)).toBe('intact');
  });

  it('spends one-time prekeys once, and only after a message decrypts', async () => {
    const alice = device(await generateDeviceKeys(5));
    const bob = device(await generateDeviceKeys(3));
    const bundle = await bundleFor('bob', bob.keys);
    alice.sessions.bob = [await startSession(alice.keys, bundle)];
    const env = await alice.send('bob', 'first');
    await expect(bob.receive('alice', { ...env, ciphertext: env.ciphertext.replace(/^./, 'A') === env.ciphertext ? 'B' + env.ciphertext.slice(1) : 'A' + env.ciphertext.slice(1) })).rejects.toThrow();
    expect(bob.keys.oneTimePreKeys.map((p) => p.id)).toContain(bundle.oneTimePreKey!.id);
    expect(await bob.receive('alice', env)).toBe('first');
    expect(bob.keys.oneTimePreKeys.map((p) => p.id)).not.toContain(bundle.oneTimePreKey!.id);
    // A second session using the same (already spent) prekey is refused.
    const mallory = device(await generateDeviceKeys(1));
    mallory.sessions.bob = [await startSession(mallory.keys, bundle)];
    await expect(bob.receive('mallory', await mallory.send('bob', 'replayed prekey'))).rejects.toThrow();
  });

  it('works without a one-time prekey, and when both sides start a session at once', async () => {
    const alice = device(await generateDeviceKeys(2));
    const bob = device(await generateDeviceKeys(2));
    alice.sessions.bob = [await startSession(alice.keys, await bundleFor('bob', bob.keys, false))];
    bob.sessions.alice = [await startSession(bob.keys, await bundleFor('alice', alice.keys, false))];
    const fromAlice = await alice.send('bob', 'hi bob');
    const fromBob = await bob.send('alice', 'hi alice');
    expect(await bob.receive('alice', fromAlice)).toBe('hi bob');
    expect(await alice.receive('bob', fromBob)).toBe('hi alice');
    // Whichever session each side now prefers, the other can read it.
    expect(await alice.receive('bob', await bob.send('alice', 'still here'))).toBe('still here');
    expect(await bob.receive('alice', await alice.send('bob', 'me too'))).toBe('me too');
  });

  it('rejects a bundle whose signed prekey was swapped (a server-in-the-middle)', async () => {
    const bob = await generateDeviceKeys(1);
    const evil = await generateDeviceKeys(1);
    const real = await bundleFor('bob', bob);
    const swapped = { ...real, signedPreKey: { ...(await publicBundle(evil)).signedPreKey } };
    expect(await verifyBundle(real)).toBe(true);
    expect(await verifyBundle(swapped)).toBe(false);
    await expect(startSession(await generateDeviceKeys(1), swapped)).rejects.toThrow(/signed/);
  });

  it('gives both people the same safety number for a device, and a different one for another key', async () => {
    const bob = await publicBundle(await generateDeviceKeys(0));
    const other = await publicBundle(await generateDeviceKeys(0));
    const a = await fingerprint(bob.identityKey, bob.signingKey);
    expect(a).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect(await fingerprint(bob.identityKey, bob.signingKey)).toBe(a);
    expect(await fingerprint(other.identityKey, other.signingKey)).not.toBe(a);
  });

  it('seals and opens with a shared key (attachments, call keys)', async () => {
    const key = randomKey();
    const sealed = await sealWithKey(key, new TextEncoder().encode('frame key'));
    expect(new TextDecoder().decode(await openWithKey(key, sealed))).toBe('frame key');
    await expect(openWithKey(randomKey(), sealed)).rejects.toThrow();
  });
});
