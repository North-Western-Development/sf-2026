import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api-service/src/index.js';
import { signAccessToken, getJwtSecret } from '@subspace/crypto';
import { transmitters, transmissions, beacons, eq } from '@subspace/database';
import { signProxyUrl } from '../../apps/api-service/src/lib/embeds.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/**
 * Link previews against a local "website". `localhost` is allow-listed for this file only
 * (UNFURL_ALLOW_PRIVATE_HOSTS, ignored in production); 127.0.0.1 stays blocked, which is
 * how the redirect test proves every hop is checked.
 */
describe('Link previews (embeds) and the media proxy', () => {
  const SECRET = getJwtSecret();
  let app: FastifyInstance;
  let db: any;
  let site: http.Server;
  let origin = '';
  let hits: Record<string, number> = {};
  const author = { id: '520652448815644673', username: 'embed_author' };
  const member = { id: '520652448815644674', username: 'embed_member' };
  const tok = (u: typeof author) => signAccessToken({ transmitterId: u.id, username: u.username, staffRank: 0 }, SECRET);
  const inject = (method: string, url: string, token?: string, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as any });
  let relayId = '';
  const previousAllow = process.env.UNFURL_ALLOW_PRIVATE_HOSTS;

  const send = async (content: string) => (await inject('POST', `/api/v1/channels/relay/${relayId}/transmissions`, tok(author), { content })).json().transmission;
  const embedsOf = async (id: string, wait = true) => {
    for (let i = 0; i < 50; i++) {
      const [row] = await db.select().from(transmissions).where(eq(transmissions.id, id)).limit(1);
      if (!wait || row.embeds.length) return row.embeds;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.UNFURL_ALLOW_PRIVATE_HOSTS = 'localhost';
    site = http.createServer((req, res) => {
      hits[req.url!] = (hits[req.url!] ?? 0) + 1;
      if (req.url === '/article') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<html><head><title>x</title><meta property="og:title" content="Warp Drive Explained"><meta property="og:description" content="A primer."><meta property="og:image" content="/hero.png"><meta property="og:site_name" content="Fleet Wiki"><meta name="theme-color" content="#ff9f43"></head></html>`);
      }
      if (req.url === '/hero.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG);
      }
      if (req.url === '/evil.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      }
      if (req.url === '/to-internal') {
        res.writeHead(302, { location: `http://127.0.0.1:${(site.address() as AddressInfo).port}/article` });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => site.listen(0, 'localhost', r));
    origin = `http://localhost:${(site.address() as AddressInfo).port}`;

    app = await buildApp();
    await app.ready();
    db = (app as any).db;
    if (!db) return;
    await (app as any).redis?.keys('unfurl:*').then((keys: string[]) => keys.length && (app as any).redis.del(...keys));
    await db.delete(beacons).where(eq(beacons.ownerId, author.id));
    for (const u of [author, member]) {
      const existing = await db.select().from(transmitters).where(eq(transmitters.id, u.id)).limit(1);
      if (!existing.length) await db.insert(transmitters).values({ id: u.id, username: u.username, email: `${u.username}@subspace.test`, passwordHash: 'x', displayName: u.username });
    }
    const beaconId = (await inject('POST', '/api/v1/beacons', tok(author), { name: 'Embeds', isDiscoverable: true })).json().beacon.id;
    await inject('POST', `/api/v1/beacons/${beaconId}/join`, tok(member));
    await inject('POST', `/api/v1/beacons/${beaconId}/onboarding/complete`, tok(member), { agreedToRules: true, selectedClearanceIds: [] });
    relayId = (await inject('GET', `/api/v1/beacons/${beaconId}/relays`, tok(author))).json().relays.find((r: any) => r.type === 'text').id;
  });

  afterAll(async () => {
    if (previousAllow === undefined) delete process.env.UNFURL_ALLOW_PRIVATE_HOSTS;
    else process.env.UNFURL_ALLOW_PRIVATE_HOSTS = previousAllow;
    await app.close();
    site.close();
  });

  it('attaches an Open Graph preview after sending, with images through the proxy', async () => {
    if (!db) return;
    const t = await send(`read this: ${origin}/article`);
    const [embed] = await embedsOf(t.id);
    expect(embed).toMatchObject({ type: 'link', url: `${origin}/article`, title: 'Warp Drive Explained', description: 'A primer.', siteName: 'Fleet Wiki', color: '#ff9f43' });
    expect(embed.thumbnail.url).toBe(`${origin}/hero.png`);
    expect(embed.thumbnail.proxyUrl).toMatch(/^\/api\/v1\/embed-proxy\?url=.+&sig=/);

    // History carries the embed too.
    const history = (await inject('GET', `/api/v1/channels/relay/${relayId}/transmissions`, tok(member))).json().transmissions;
    expect(history.find((h: any) => h.id === t.id).embeds[0].title).toBe('Warp Drive Explained');

    // The proxy serves the image with a locked-down policy.
    const img = await inject('GET', embed.thumbnail.proxyUrl);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['content-security-policy']).toContain("default-src 'none'");
    expect(img.headers['x-content-type-options']).toBe('nosniff');
  });

  it('caches previews instead of refetching the page', async () => {
    if (!db) return;
    const before = hits['/article'];
    const t = await send(`again ${origin}/article`);
    expect((await embedsOf(t.id))[0].title).toBe('Warp Drive Explained');
    expect(hits['/article']).toBe(before);
  });

  it('refuses to proxy unsigned URLs or SVG', async () => {
    if (!db) return;
    const url = `${origin}/hero.png`;
    expect((await inject('GET', `/api/v1/embed-proxy?url=${encodeURIComponent(url)}&sig=forged`)).statusCode).toBe(403);
    const internal = 'http://169.254.169.254/latest/meta-data/';
    const signedInternal = await inject('GET', `/api/v1/embed-proxy?url=${encodeURIComponent(internal)}&sig=${signProxyUrl(internal)}`);
    expect(signedInternal.statusCode).toBe(404);
    const svg = `${origin}/evil.svg`;
    expect((await inject('GET', `/api/v1/embed-proxy?url=${encodeURIComponent(svg)}&sig=${signProxyUrl(svg)}`)).statusCode).toBe(404);
  });

  it('checks every redirect hop, so a public link cannot bounce into the private network', async () => {
    if (!db) return;
    const t = await send(`${origin}/to-internal`);
    await new Promise((r) => setTimeout(r, 800));
    expect(await embedsOf(t.id, false)).toEqual([]);
    const res = await inject('POST', '/api/v1/unfurl', tok(author), { url: `${origin}/to-internal` });
    expect(res.statusCode).toBe(502);
  });

  it('skips links in code and angle brackets', async () => {
    if (!db) return;
    const t = await send(`\`${origin}/article\` and <${origin}/article>`);
    await new Promise((r) => setTimeout(r, 500));
    expect(await embedsOf(t.id, false)).toEqual([]);
  });

  it('lets only the author remove embeds, and edits refresh them', async () => {
    if (!db) return;
    const t = await send(`${origin}/article`);
    await embedsOf(t.id);
    expect((await inject('DELETE', `/api/v1/transmissions/${t.id}/embeds`, tok(member))).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/transmissions/${t.id}/embeds`, tok(author))).statusCode).toBe(204);
    const [row] = await db.select().from(transmissions).where(eq(transmissions.id, t.id)).limit(1);
    expect(row).toMatchObject({ embeds: [], suppressEmbeds: true });

    const t2 = await send(`${origin}/article`);
    await embedsOf(t2.id);
    await inject('PATCH', `/api/v1/transmissions/${t2.id}`, tok(author), { content: 'no links any more' });
    for (let i = 0; i < 30 && (await embedsOf(t2.id, false)).length; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await embedsOf(t2.id, false)).toEqual([]);
  });
});
