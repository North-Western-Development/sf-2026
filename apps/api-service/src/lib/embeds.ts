import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, transmissions } from '@subspace/database';
import { getJwtSecret } from '@subspace/crypto';
import { safeGet, UnsafeUrlError } from './safe-fetch.js';
import { publishGatewayEvent, audienceForTransmission } from './events.js';
import { deriveChannel } from './transmissions.js';

/** A link preview attached to a transmission, Discord-embed shaped. */
export interface Embed {
  type: 'link' | 'image' | 'video' | 'article';
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  color?: string;
  /** Small image beside the text. */
  thumbnail?: EmbedImage;
  /** Large image under the text (twitter:card summary_large_image, or a direct image link). */
  image?: EmbedImage;
}

export interface EmbedImage {
  url: string;
  /** Same image through our media proxy, so viewers never connect to the third-party host. */
  proxyUrl: string;
  width?: number;
  height?: number;
}

export const MAX_EMBEDS = 5;
const CACHE_TTL_SECONDS = 60 * 60;
const FAILED_TTL_SECONDS = 10 * 60;

/** Links in a transmission that should be previewed: not inside code, not wrapped in <...>. */
export function extractPreviewUrls(content: string): string[] {
  const stripped = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<https?:\/\/[^>\s]+>/g, ' ')
    // Spoilers hide their links too.
    .replace(/\|\|[\s\S]*?\|\|/g, ' ');
  const out: string[] = [];
  for (const m of stripped.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    // Trailing punctuation belongs to the sentence, not the link; a ")" only if unbalanced.
    let url = m[0].replace(/[.,;:!?]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    try {
      const parsed = new URL(url);
      if (!out.includes(parsed.href)) out.push(parsed.href);
    } catch {
      /* not a URL */
    }
    if (out.length >= MAX_EMBEDS) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/** Open Graph / Twitter / HTML metadata from a page's head. */
export function parsePageMetadata(html: string, pageUrl: string) {
  const head = html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = decode(a.content);
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const abs = (u?: string) => {
    if (!u) return undefined;
    try {
      const resolved = new URL(u, pageUrl);
      return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : undefined;
    } catch {
      return undefined;
    }
  };
  const num = (v?: string) => (v && /^\d{1,5}$/.test(v) ? Number(v) : undefined);
  const color = meta['theme-color'];
  return {
    title: meta['og:title'] || meta['twitter:title'] || (titleTag ? decode(titleTag) : undefined),
    description: meta['og:description'] || meta['twitter:description'] || meta['description'],
    siteName: meta['og:site_name'] || meta['application-name'],
    image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src']),
    imageWidth: num(meta['og:image:width']),
    imageHeight: num(meta['og:image:height']),
    largeImage: meta['twitter:card'] === 'summary_large_image',
    type: meta['og:type'],
    color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined,
  };
}

// --- Media proxy signing -------------------------------------------------------------

function proxyKey() {
  return crypto.createHash('sha256').update(`embed-proxy:${process.env.MEDIA_PROXY_SECRET || getJwtSecret()}`).digest();
}

export function signProxyUrl(url: string): string {
  return crypto.createHmac('sha256', proxyKey()).update(url).digest('base64url');
}

export function verifyProxySignature(url: string, sig: string): boolean {
  const expected = Buffer.from(signProxyUrl(url));
  const given = Buffer.from(sig || '');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export const proxied = (url: string, width?: number, height?: number): EmbedImage => ({
  url,
  proxyUrl: `/api/v1/embed-proxy?url=${encodeURIComponent(url)}&sig=${signProxyUrl(url)}`,
  ...(width ? { width } : {}),
  ...(height ? { height } : {}),
});

// --- Unfurling -----------------------------------------------------------------------

const clip = (s: string | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : undefined);

/** Fetch one URL and turn it into an embed. Null when there is nothing worth showing. */
export async function unfurl(url: string): Promise<Embed | null> {
  const res = await safeGet(url, { stopAfterBytes: 512 * 1024, timeoutMs: 5000 });
  if (res.status < 200 || res.status >= 300) return null;
  if (/^image\/(png|jpe?g|gif|webp|avif)/.test(res.contentType)) return { type: 'image', url, image: proxied(url) };
  if (!/text\/html|application\/xhtml/.test(res.contentType)) return null;
  const meta = parsePageMetadata(res.body.toString('utf8'), res.url);
  if (!meta.title && !meta.description && !meta.image) return null;
  const image = meta.image ? proxied(meta.image, meta.imageWidth, meta.imageHeight) : undefined;
  return {
    type: meta.type?.startsWith('video') ? 'video' : meta.type === 'article' ? 'article' : 'link',
    url,
    title: clip(meta.title, 256),
    description: clip(meta.description, 350),
    siteName: clip(meta.siteName, 100),
    color: meta.color,
    ...(image ? (meta.largeImage ? { image } : { thumbnail: image }) : {}),
  };
}

/** Unfurl with a Redis cache shared by every instance; failures are cached briefly too. */
export async function unfurlCached(app: FastifyInstance, url: string): Promise<Embed | null> {
  const redis = (app as any).redis;
  const key = `unfurl:${crypto.createHash('sha1').update(url).digest('hex')}`;
  if (redis?.status === 'ready') {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return hit === 'null' ? null : JSON.parse(hit);
  }
  let embed: Embed | null = null;
  try {
    embed = await unfurl(url);
  } catch (err) {
    if (!(err instanceof UnsafeUrlError)) app.log.debug({ url, err: (err as Error).message }, 'unfurl failed');
  }
  if (redis?.status === 'ready') {
    await redis.set(key, JSON.stringify(embed), 'EX', embed ? CACHE_TTL_SECONDS : FAILED_TTL_SECONDS).catch(() => {});
  }
  return embed;
}

/**
 * Build the embeds for a transmission in the background and push them to everyone who can
 * see it. Called after create and after an edit changes the links.
 */
export function scheduleEmbeds(app: FastifyInstance, row: { id: string; content: string; suppressEmbeds?: boolean | null }) {
  const db = (app as any).db;
  if (!db || row.suppressEmbeds) return;
  const urls = extractPreviewUrls(row.content || '');
  const previous = (row as any).embeds as Embed[] | undefined;
  if (!urls.length && !previous?.length) return;
  void (async () => {
    const embeds = (await Promise.all(urls.map((u) => unfurlCached(app, u)))).filter(Boolean) as Embed[];
    const [current] = await db.select().from(transmissions).where(eq(transmissions.id, row.id)).limit(1);
    // Deleted, suppressed, or edited again while we were fetching: the newer run wins.
    if (!current || current.suppressEmbeds || current.content !== row.content) return;
    if (JSON.stringify(current.embeds ?? []) === JSON.stringify(embeds)) return;
    await db.update(transmissions).set({ embeds }).where(eq(transmissions.id, row.id));
    const channel = deriveChannel(current);
    await publishGatewayEvent(
      app,
      'TRANSMISSION_EMBEDS_UPDATE',
      { channelType: channel?.channelType, channelId: channel?.channelId, transmissionId: row.id, embeds },
      await audienceForTransmission(db, current)
    );
  })().catch((err) => app.log.warn({ err: (err as Error).message, id: row.id }, 'embed generation failed'));
}
