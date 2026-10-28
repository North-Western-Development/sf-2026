import { describe, it, expect, vi } from 'vitest';
import { ActivitySdk, ActivitySdkError, readLaunchParams, type WindowLike } from '../../packages/activity-sdk/src/index';

/** @subspace/activity-sdk: it only talks to the parent it was launched by, with its frame's nonce. */
const PARENT = 'https://subspace.example';
const FRAME = 'a'.repeat(32);
const CLIENT = '123456789012345678';
const hashFor = (origin = PARENT, frame = FRAME) => `#frame_id=${frame}&parent_origin=${encodeURIComponent(origin)}&instance_id=42`;

/** referrer: what the browser reports; Subspace frames with referrerPolicy="origin", so its origin by default. */
function fakeWindow(hash = hashFor(), ancestorOrigins?: string[], referrer = `${PARENT}/`) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const posted: Array<{ msg: any; origin: string }> = [];
  const parent = { postMessage: (msg: any, origin: string) => posted.push({ msg, origin }) };
  const win: WindowLike = {
    parent,
    location: { hash, ...(ancestorOrigins ? { ancestorOrigins: Object.assign([...ancestorOrigins], { length: ancestorOrigins.length }) } : {}) },
    document: { referrer },
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    crypto: globalThis.crypto,
  };
  const deliver = (data: unknown, from: { source?: unknown; origin?: string } = {}) =>
    listeners.forEach((fn) => fn({ data, source: 'source' in from ? from.source : parent, origin: from.origin ?? PARENT } as MessageEvent));
  const reply = (nonce: string, data: unknown, extra: Record<string, unknown> = {}) => deliver({ subspace: 'host', v: 1, frameId: FRAME, nonce, ok: true, data, ...extra });
  return { win, posted, parent, deliver, reply, listeners };
}

const HANDSHAKE = {
  instance: { id: '42', channelId: '7', beaconId: '8', hostId: '1' },
  user: { id: '1', username: 'ada', displayName: 'Ada', avatarUrl: null },
  participants: [{ id: '1', username: 'ada', displayName: 'Ada', avatarUrl: null }],
  application: { id: CLIENT, name: 'Counter' },
};

async function connected() {
  const f = fakeWindow();
  const sdk = new ActivitySdk({ clientId: CLIENT, window: f.win, allowedOrigins: [PARENT] });
  const ready = sdk.ready();
  f.reply(f.posted[0].msg.nonce, HANDSHAKE);
  await ready;
  return { ...f, sdk };
}

describe('Activity SDK origin and nonce checks', () => {
  it('reads only well-formed launch parameters', () => {
    expect(readLaunchParams(hashFor())).toEqual({ frameId: FRAME, parentOrigin: PARENT, instanceId: '42' });
    expect(readLaunchParams(hashFor('https://subspace.example/path')).parentOrigin).toBeNull();
    expect(readLaunchParams(hashFor('javascript:alert(1)')).parentOrigin).toBeNull();
    expect(readLaunchParams(hashFor(PARENT, 'not-hex')).frameId).toBeNull();
  });

  it('refuses to start outside Subspace, from a disallowed origin, or when the browser says the parent is someone else', async () => {
    const outside = fakeWindow('');
    await expect(new ActivitySdk({ clientId: CLIENT, window: outside.win }).ready()).rejects.toMatchObject({ code: 'NOT_LAUNCHED' });

    const notOurs = fakeWindow(hashFor('https://evil.example'));
    await expect(new ActivitySdk({ clientId: CLIENT, window: notOurs.win, allowedOrigins: [PARENT] }).ready()).rejects.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
    expect(notOurs.posted).toHaveLength(0);
    expect(notOurs.listeners.size).toBe(0);

    const lying = fakeWindow(hashFor(), ['https://evil.example']);
    await expect(new ActivitySdk({ clientId: CLIENT, window: lying.win }).ready()).rejects.toMatchObject({ code: 'ORIGIN_MISMATCH' });
    expect(lying.posted).toHaveLength(0);

    const top = fakeWindow();
    (top.win as any).parent = top.win;
    await expect(new ActivitySdk({ clientId: CLIENT, window: top.win }).ready()).rejects.toMatchObject({ code: 'NOT_FRAMED' });

    expect(() => new ActivitySdk({ clientId: 'nope', window: fakeWindow().win })).toThrow(ActivitySdkError);
  });

  it('posts the handshake only to the exact parent origin, with its frame id and a fresh nonce', async () => {
    const f = fakeWindow(hashFor(), [PARENT]);
    const sdk = new ActivitySdk({ clientId: CLIENT, window: f.win });
    const ready = sdk.ready().catch((e) => e);
    expect(f.posted).toHaveLength(1);
    const { msg, origin } = f.posted[0];
    expect(origin).toBe(PARENT);
    expect(msg).toMatchObject({ subspace: 'activity', v: 1, frameId: FRAME, cmd: 'HANDSHAKE', args: { clientId: CLIENT, v: 1 } });
    expect(msg.nonce).toMatch(/^[0-9a-f]{32}$/);
    sdk.destroy();
    expect((await ready).code).toBe('DESTROYED');
  });

  it('ignores answers from another origin, another window, another frame or an unknown nonce', async () => {
    const f = fakeWindow();
    const sdk = new ActivitySdk({ clientId: CLIENT, window: f.win, allowedOrigins: [PARENT] });
    const ready = sdk.ready();
    let settled = false;
    void ready.then(() => (settled = true));
    const nonce = f.posted[0].msg.nonce;
    const good = { subspace: 'host', v: 1, frameId: FRAME, nonce, ok: true, data: HANDSHAKE };
    f.deliver(good, { origin: 'https://evil.example' });
    f.deliver(good, { source: {} });
    f.deliver(good, { source: null });
    f.deliver({ ...good, frameId: 'b'.repeat(32) });
    f.deliver({ ...good, nonce: 'c'.repeat(32) });
    f.deliver({ ...good, subspace: 'activity' });
    f.deliver({ ...good, v: 2 });
    f.deliver('not an object');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(sdk.user).toBeNull();

    f.deliver(good);
    await ready;
    expect(sdk.user?.username).toBe('ada');
    expect(sdk.instance?.id).toBe('42');
    // A nonce answers once: a replay changes nothing.
    f.deliver({ ...good, data: { ...HANDSHAKE, user: { id: '9', username: 'mallory' } } });
    expect(sdk.user?.username).toBe('ada');
  });

  it('takes events only after the handshake and only from the parent', async () => {
    const f = fakeWindow();
    const sdk = new ActivitySdk({ clientId: CLIENT, window: f.win, allowedOrigins: [PARENT] });
    const seen = vi.fn();
    sdk.on('participants', seen);
    const ready = sdk.ready();
    const event = { subspace: 'host', v: 1, frameId: FRAME, event: 'participants', data: { hostId: '1', participants: [{ id: '5', username: 'early' }] } };
    f.deliver(event);
    expect(seen).not.toHaveBeenCalled();
    f.reply(f.posted[0].msg.nonce, HANDSHAKE);
    await ready;

    f.deliver({ ...event, data: { hostId: '2', participants: [{ id: '2', username: 'bob' }] } }, { origin: 'https://evil.example' });
    expect(seen).not.toHaveBeenCalled();
    f.deliver({ ...event, data: { hostId: '2', participants: [HANDSHAKE.user, { id: '2', username: 'bob' }] } });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(sdk.participants.map((p) => p.username)).toEqual(['ada', 'bob']);
    expect(sdk.instance?.hostId).toBe('2');

    const messages = vi.fn();
    const off = sdk.on('message', messages);
    f.deliver({ subspace: 'host', v: 1, frameId: FRAME, event: 'message', data: { from: '2', payload: { count: 3 } } });
    expect(messages).toHaveBeenCalledWith({ from: '2', payload: { count: 3 } });
    off();
    f.deliver({ subspace: 'host', v: 1, frameId: FRAME, event: 'message', data: { from: '2', payload: 4 } });
    expect(messages).toHaveBeenCalledTimes(1);
  });

  it('resolves authorize with the code and rejects with the refusal code', async () => {
    const { sdk, posted, reply, deliver } = await connected();
    const auth = sdk.authorize({ scopes: ['identify'] });
    await Promise.resolve();
    const req = posted[1].msg;
    expect(req).toMatchObject({ cmd: 'AUTHORIZE', args: { scopes: ['identify'] } });
    expect(posted[1].origin).toBe(PARENT);
    reply(req.nonce, { code: 'the-code', scopes: ['identify'] });
    await expect(auth).resolves.toEqual({ code: 'the-code', scopes: ['identify'] });

    const link = sdk.openExternalLink('https://example.com');
    await Promise.resolve();
    deliver({ subspace: 'host', v: 1, frameId: FRAME, nonce: posted[2].msg.nonce, ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down' } });
    await expect(link).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('times out a handshake nobody answers, and destroy() rejects what is pending', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeWindow();
      const sdk = new ActivitySdk({ clientId: CLIENT, window: f.win, timeoutMs: 1000 });
      const ready = sdk.ready();
      vi.advanceTimersByTime(1001);
      await expect(ready).rejects.toMatchObject({ code: 'TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
    const { sdk, listeners } = await connected();
    const pending = sdk.broadcast({ hi: 1 });
    await Promise.resolve();
    sdk.destroy();
    await expect(pending).rejects.toMatchObject({ code: 'DESTROYED' });
    expect(listeners.size).toBe(0);
  });
});

describe('Activity SDK: hostile launch parameters and replies (security)', () => {
  it('only an exact, bare origin counts as parent_origin', () => {
    for (const bad of ['HTTPS://SUBSPACE.EXAMPLE', 'https://subspace.example:443', 'https://subspace.example/', 'https://user@subspace.example', 'null', '*', '', 'data:text/html,x', 'https://subspace.example#x', ' https://subspace.example']) {
      expect(readLaunchParams(hashFor(bad)).parentOrigin, bad).toBeNull();
    }
    for (const bad of ['A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), `${'a'.repeat(32)}\n`]) expect(readLaunchParams(hashFor(PARENT, bad)).frameId, JSON.stringify(bad)).toBeNull();
    // A repeated parameter: the first one wins, and is still checked.
    expect(readLaunchParams(`#frame_id=${FRAME}&parent_origin=${encodeURIComponent('https://evil.example/x')}&parent_origin=${encodeURIComponent(PARENT)}`).parentOrigin).toBeNull();
  });

  // Fixed (was a security bug): Firefox has no location.ancestorOrigins, so a page that framed the
  // activity itself could claim any parent_origin. The browser-set referrer now has to agree.
  it('where the browser has no ancestorOrigins, the referrer must name the claimed parent', async () => {
    // A hostile page frames the activity and claims to be Subspace: the referrer says who it is.
    const claims = fakeWindow(hashFor(), undefined, 'https://evil.example/');
    // It hides the referrer (referrerpolicy="no-referrer"): nothing to check, so no start.
    const hidden = fakeWindow(hashFor('https://evil.example'), undefined, '');
    for (const [f, code] of [[claims, 'ORIGIN_MISMATCH'], [hidden, 'ORIGIN_UNVERIFIED']] as const) {
      const sdk = new ActivitySdk({ clientId: CLIENT, window: f.win });
      expect(sdk.parentOrigin).toBeNull();
      await expect(sdk.ready()).rejects.toMatchObject({ code });
      expect(f.posted).toHaveLength(0);
    }
    // With allowedOrigins pinned, a missing referrer is fine: postMessage only reaches that origin.
    const pinned = fakeWindow(hashFor(), undefined, '');
    expect(new ActivitySdk({ clientId: CLIENT, window: pinned.win, allowedOrigins: [PARENT] }).parentOrigin).toBe(PARENT);
    // Subspace itself (referrer = its origin) starts without allowedOrigins.
    expect(new ActivitySdk({ clientId: CLIENT, window: fakeWindow(hashFor(), undefined).win }).parentOrigin).toBe(PARENT);
    // A page that names itself honestly is its real parent, as in every browser: only allowedOrigins
    // (and frame-ancestors on the activity's own page) keep other sites from hosting it.
    const honest = fakeWindow(hashFor('https://evil.example'), undefined, 'https://evil.example/game');
    expect(new ActivitySdk({ clientId: CLIENT, window: honest.win }).parentOrigin).toBe('https://evil.example');
    await expect(new ActivitySdk({ clientId: CLIENT, window: honest.win, allowedOrigins: [PARENT] }).ready()).rejects.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
    // ancestorOrigins, where present, wins over the referrer.
    expect(new ActivitySdk({ clientId: CLIENT, window: fakeWindow(hashFor(), [PARENT], 'https://evil.example/').win }).parentOrigin).toBe(PARENT);
  });

  it('hostile replies (prototype keys, huge payloads, non-string codes) never throw out of the message handler', async () => {
    const { sdk, deliver } = await connected();
    expect(() => deliver({ subspace: 'host', v: 1, frameId: FRAME, nonce: '__proto__', ok: true, data: {} })).not.toThrow();
    expect(() => deliver({ subspace: 'host', v: 1, frameId: FRAME, nonce: 'constructor', ok: false, error: { code: { toString: null } } })).not.toThrow();
    expect(() => deliver({ subspace: 'host', v: 1, frameId: FRAME, event: 'participants', data: { participants: 'not an array' } })).not.toThrow();
    expect(() => deliver({ subspace: 'host', v: 1, frameId: FRAME, event: 'message', data: { from: 5, payload: 'x'.repeat(100_000) } })).not.toThrow();
    expect(sdk.participants).toHaveLength(1);
  });
});
