import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { isPrivateAddress, resolveSafe, safeGet } from '../../apps/api-service/src/lib/safe-fetch.js';
import { sanitizeActivity, isInstanceImage, ACTIVITY_LIMITS } from '@subspace/constants';
import { person, caller, seedPeople, cleanupPeople } from '../support/security.js';

/**
 * Security: Rich Presence / activity sanitising, the image rules viewers rely on, the outbound
 * fetch guard (safe-fetch) and POST /embed-proxy/sign, which turns activity image URLs into proxy
 * addresses. (Gateway visibility of activities is in security-developer-policy.test.ts.)
 */
describe('Security: activity sanitising', () => {
  const now = Date.now();
  const base = { name: 'Game' };

  it('buttons and images: only https, no credentials, no scripts or data', () => {
    const hostile = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:image/png;base64,AAAA', 'vbscript:x', 'http://example.com/a.png', 'file:///etc/passwd', 'https://user:pw@example.com/a.png', '//example.com/a.png', 'blob:https://example.com/x'];
    for (const url of hostile) {
      const a = sanitizeActivity({ ...base, largeImage: url, smallImage: url, buttons: [{ label: 'Go', url }] }, now)!;
      expect(a.largeImage, url).toBeUndefined();
      expect(a.smallImage, url).toBeUndefined();
      expect(a.buttons, url).toBeUndefined();
    }
    const ok = sanitizeActivity({ ...base, largeImage: 'https://cdn.example.com/a.png', buttons: [{ label: 'Join', url: 'https://example.com/join' }] }, now)!;
    expect(ok).toMatchObject({ largeImage: 'https://cdn.example.com/a.png', buttons: [{ label: 'Join', url: 'https://example.com/join' }] });
  });

  it('oversized and wrongly typed fields are cut or dropped, never passed through', () => {
    const a = sanitizeActivity(
      {
        name: 'n'.repeat(5000),
        details: 'd'.repeat(5000),
        state: { toString: () => 'x' },
        largeText: ['array'],
        party: { size: 1e9, max: 1e9 },
        startedAt: Number.MAX_SAFE_INTEGER,
        endsAt: -1,
        buttons: Array.from({ length: 50 }, (_, i) => ({ label: 'b'.repeat(500) + i, url: 'https://example.com/' + i })),
        type: 'hacking',
        source: 'staff',
        applicationId: '0123',
        extra: '<script>',
        __proto__: { polluted: true },
      },
      now
    )!;
    expect(a.name.length).toBeLessThanOrEqual(ACTIVITY_LIMITS.name);
    expect(a.details!.length).toBeLessThanOrEqual(ACTIVITY_LIMITS.text);
    expect(a.state).toBeUndefined();
    expect(a.largeText).toBeUndefined();
    expect(a.party).toBeUndefined();
    expect(a.startedAt).toBeUndefined();
    expect(a.endsAt).toBeUndefined();
    expect(a.buttons!.length).toBe(ACTIVITY_LIMITS.buttons);
    expect(a.buttons!.every((b) => b.label.length <= ACTIVITY_LIMITS.buttonLabel)).toBe(true);
    expect(a.type).toBe('playing');
    expect(a.source).toBe('detected');
    expect(a.applicationId).toBeUndefined();
    expect(Object.keys(a).sort()).toEqual(['buttons', 'details', 'name', 'source', 'type']);
    expect(JSON.stringify(a)).not.toContain('<script>');
    for (const junk of [null, undefined, 'string', 42, [], { name: '' }, { name: '   ' }, { name: '\u0000\u001f' }]) expect(sanitizeActivity(junk as any, now)).toBeNull();
  });

  it('control characters are stripped from every text field', () => {
    const a = sanitizeActivity({ name: 'A\u0000B\u0007C\nD\r\u001b[31m', details: '\u0008x' }, now)!;
    expect(a.name).toBe('ABCD[31m');
    expect(a.details).toBe('x');
  });

  // SECURITY BUG (low, spoofing): text() in packages/constants/src/activity.ts strips C0 controls
  // and DEL only. Unicode bidi overrides/isolates (U+202A-U+202E, U+2066-U+2069) and zero-width
  // characters pass through, so an activity name like "Valheim‮...", reversed on screen, or
  // a name padded with invisible characters can impersonate another game or a verified app's
  // title in profiles and member lists. Fix: also strip /[​-‏‪-‮⁠-⁩﻿]/g.
  it('bidi overrides and zero-width characters are stripped from activity text', () => {
    const a = sanitizeActivity({ name: 'Safe‮emag', details: 'zero​width', state: '⁦iso⁩' }, now)!;
    expect(a.name).toBe('Safeemag');
    expect(a.details).toBe('zerowidth');
    expect(a.state).toBe('iso');
  });

  it('instance images: the proxy and our uploads only, without quotes, spaces or ..', () => {
    for (const ok of ['/api/v1/embed-proxy?url=https%3A%2F%2Fa.com%2Fx.png&sig=abc', '/subspace-media/app-icon/x.png']) expect(isInstanceImage(ok), ok).toBe(true);
    for (const bad of ['/api/v1/users/@me', '/subspace-media/../api/v1/users/@me', '/subspace-media/x"onerror="alert(1)', "/subspace-media/x'y", '/subspace-media/x y', '/subspace-media/x<y', '/subspace-media/\\..\\x', 'https://evil.example/subspace-media/x.png']) {
      expect(isInstanceImage(bad), bad).toBe(false);
    }
  });

  // SECURITY BUG (low): isInstanceImage (packages/constants/src/activity.ts) refuses a literal ".."
  // but not its percent-encoded forms. Browsers treat "%2e%2e" / ".%2e" path segments as ".."
  // (WHATWG URL), so "/subspace-media/%2e%2e/api/v1/..." passes sanitizeActivity and every viewer's
  // <img> requests an arbitrary same-origin path (any GET endpoint, with the viewer's cookies),
  // not just uploads or the media proxy. Fix: decode before checking, or resolve with
  // new URL(v, 'https://x').pathname and require it to still start with the allowed prefix.
  it('instance images: percent-encoded dot segments do not escape /subspace-media/', () => {
    for (const bad of ['/subspace-media/%2e%2e/api/v1/users/@me/oauth2/grants', '/subspace-media/.%2e/api/v1/x', '/subspace-media/%2E%2E/x']) {
      expect(isInstanceImage(bad), bad).toBe(false);
      expect(sanitizeActivity({ name: 'G', largeImage: bad }, now)!.largeImage, bad).toBeUndefined();
    }
  });
});

describe('Security: outbound fetch guard (safe-fetch)', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and reserved addresses in every notation', () => {
    const blocked = [
      '127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:0001', '::127.0.0.1', '64:ff9b::a9fe:a9fe', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', 'fec0::1',
      'not-an-ip', '',
    ];
    for (const ip of blocked) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '172.32.0.1', '100.128.0.1']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  // SECURITY BUG (low, hardening): isPrivateV6 (apps/api-service/src/lib/safe-fetch.ts) misses
  // some special-purpose IPv6 ranges that embed or route to IPv4/internal space: IPv4-translated
  // ::ffff:0:a.b.c.d (RFC 2765), local-use NAT64 64:ff9b:1::/48 (RFC 8215), 6to4 2002::/16 with a
  // private embedded IPv4, Teredo 2001::/32, the discard prefix 100::/64; and IPv4 192.88.99.0/24.
  // Most are not routable on a typical host, but on hosts with NAT64/6to4 they reach internal
  // IPv4. Fix: treat these prefixes as private (and check the embedded IPv4 for 2002::/16).
  it('also blocks IPv6 transition ranges that embed private IPv4', () => {
    for (const ip of ['::ffff:0:127.0.0.1', '::ffff:0:7f00:1', '64:ff9b:1::7f00:1', '2002:7f00:1::1', '2002:a00:1::1', '2001::1', '100::1', '192.88.99.1']) expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it('resolveSafe refuses private targets however the URL spells them, and credentials and other schemes', async () => {
    const saved = process.env.UNFURL_ALLOW_PRIVATE_HOSTS;
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = '';
    try {
      for (const u of ['https://127.0.0.1/', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://0177.0.0.1/', 'https://127.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:a9fe:a9fe]/', 'https://169.254.169.254./', 'https://localhost/', 'https://LOCALHOST./', 'https://user:pw@1.1.1.1/', 'ftp://1.1.1.1/', 'file:///etc/passwd', 'gopher://1.1.1.1/']) {
        await expect(resolveSafe(new URL(u)), u).rejects.toThrow();
      }
      // Redirects are re-checked at every hop: a public URL that redirects to a private one fails.
      await expect(safeGet('http://127.0.0.1:1/', { timeoutMs: 1000 })).rejects.toThrow();
    } finally {
      process.env.UNFURL_ALLOW_PRIVATE_HOSTS = saved;
    }
  });

  it('the private-host allow-list is ignored in production', async () => {
    const saved = { env: process.env.NODE_ENV, allow: process.env.UNFURL_ALLOW_PRIVATE_HOSTS };
    process.env.NODE_ENV = 'production';
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = '127.0.0.1,localhost';
    try {
      await expect(resolveSafe(new URL('https://127.0.0.1/'))).rejects.toThrow();
    } finally {
      process.env.NODE_ENV = saved.env;
      process.env.UNFURL_ALLOW_PRIVATE_HOSTS = saved.allow;
    }
  });
});

describe('Security: POST /embed-proxy/sign and GET /embed-proxy', () => {
  let app: FastifyInstance;
  let db: any;
  const user = person('803756946623550001', 'sap_user');
  const { call } = caller(() => app);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (db) await seedPeople(db, [user]);
  });
  afterAll(async () => {
    await cleanupPeople(db, [user]);
    await app.close();
  });

  it('needs a signed-in person, signs only https URLs, at most 8 at a time', async () => {
    if (!db) return;
    expect((await app.inject({ method: 'POST', url: '/api/v1/embed-proxy/sign', payload: { urls: ['https://example.com/a.png'] } })).statusCode).toBe(401);
    const res = await call(user, 'POST', '/embed-proxy/sign', { urls: ['https://example.com/a.png', 'http://example.com/b.png', 'javascript:alert(1)', 'data:image/png;base64,AA', 'not a url', '/relative.png', 'file:///etc/passwd'] });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().proxied)).toEqual(['https://example.com/a.png']);
    expect(res.json().proxied['https://example.com/a.png']).toMatch(/^\/api\/v1\/embed-proxy\?url=https%3A%2F%2Fexample\.com%2Fa\.png&sig=[\w-]+$/);
    expect((await call(user, 'POST', '/embed-proxy/sign', { urls: Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.png`) })).statusCode).toBe(400);
    expect((await call(user, 'POST', '/embed-proxy/sign', { urls: ['https://example.com/' + 'a'.repeat(600)] })).statusCode).toBe(400);
    expect((await call(user, 'POST', '/embed-proxy/sign', { urls: 'https://example.com/a.png' })).statusCode).toBeLessThan(500);
    expect((await call(user, 'POST', '/embed-proxy/sign', { urls: [{ toString: 'x' }] })).statusCode).toBe(400);
  });

  it('a signature is bound to its exact URL, and the proxy refuses private hosts even when signed', async () => {
    if (!db) return;
    const saved = process.env.UNFURL_ALLOW_PRIVATE_HOSTS;
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = '';
    try {
      const targets = ['https://127.0.0.1/a.png', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/a.png', 'https://2130706433/a.png', 'https://localhost/a.png'];
      const signed = (await call(user, 'POST', '/embed-proxy/sign', { urls: targets })).json().proxied;
      for (const t of targets) {
        const proxy = signed[t] ?? signed[new URL(t).toString()];
        expect(proxy, t).toBeTruthy();
        const res = await app.inject({ method: 'GET', url: proxy });
        expect(res.statusCode, t).toBe(404);
      }
      // Swapping the URL under someone else's signature.
      const good = new URL(signed['https://127.0.0.1/a.png'], 'http://x');
      const swapped = `/api/v1/embed-proxy?url=${encodeURIComponent('https://evil.example/a.png')}&sig=${good.searchParams.get('sig')}`;
      expect((await app.inject({ method: 'GET', url: swapped })).statusCode).toBe(403);
      for (const sig of ['', 'x', 'A'.repeat(43), 'A'.repeat(65)]) {
        expect((await app.inject({ method: 'GET', url: `/api/v1/embed-proxy?url=${encodeURIComponent('https://example.com/a.png')}&sig=${sig}` })).statusCode, sig).toBeGreaterThanOrEqual(400);
      }
    } finally {
      process.env.UNFURL_ALLOW_PRIVATE_HOSTS = saved;
    }
  });
});
