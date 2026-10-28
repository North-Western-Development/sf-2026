import { proxied, type Embed } from './embeds.js';

/**
 * Rich embeds sent by webhooks and bots (Discord's embed object, with its limits). Images go
 * through the media proxy like link previews, so viewers never connect to the third-party host.
 */
export interface RichEmbedInput {
  title?: string;
  description?: string;
  url?: string;
  color?: number | string;
  timestamp?: string;
  author?: { name: string; url?: string };
  footer?: { text: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export const RICH_EMBEDS_SCHEMA = {
  type: 'array',
  maxItems: 10,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', maxLength: 256 },
      description: { type: 'string', maxLength: 4096 },
      url: { type: 'string', maxLength: 2048 },
      color: { anyOf: [{ type: 'integer', minimum: 0, maximum: 0xffffff }, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }] },
      timestamp: { type: 'string', maxLength: 40 },
      author: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', maxLength: 256 }, url: { type: 'string', maxLength: 2048 } } },
      footer: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 2048 } } },
      image: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', maxLength: 2048 } } },
      thumbnail: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', maxLength: 2048 } } },
      fields: {
        type: 'array',
        maxItems: 25,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'value'],
          properties: { name: { type: 'string', maxLength: 256 }, value: { type: 'string', maxLength: 1024 }, inline: { type: 'boolean' } },
        },
      },
    },
  },
} as const;

const httpUrl = (u?: string) => {
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

export class EmbedError extends Error {}

/** Checked and normalized; throws EmbedError past Discord's 6000-character total. */
export function normalizeRichEmbeds(input: RichEmbedInput[] | undefined): Embed[] {
  if (!input?.length) return [];
  let total = 0;
  const out = input.map((e) => {
    total += (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0);
    for (const f of e.fields ?? []) total += f.name.length + f.value.length;
    const color = typeof e.color === 'number' ? `#${e.color.toString(16).padStart(6, '0')}` : e.color;
    const image = httpUrl(e.image?.url);
    const thumb = httpUrl(e.thumbnail?.url);
    const ts = e.timestamp && !Number.isNaN(Date.parse(e.timestamp)) ? new Date(e.timestamp).toISOString() : undefined;
    const embed: Embed = {
      type: 'rich',
      url: httpUrl(e.url) ?? '',
      ...(e.title ? { title: e.title } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(color ? { color: color.toUpperCase() } : {}),
      ...(image ? { image: proxied(image) } : {}),
      ...(thumb ? { thumbnail: proxied(thumb) } : {}),
      ...(e.author ? { author: { name: e.author.name, ...(httpUrl(e.author.url) ? { url: httpUrl(e.author.url) } : {}) } } : {}),
      ...(e.footer ? { footer: { text: e.footer.text } } : {}),
      ...(e.fields?.length ? { fields: e.fields.map((f) => ({ name: f.name, value: f.value, inline: !!f.inline })) } : {}),
      ...(ts ? { timestamp: ts } : {}),
    };
    return embed;
  });
  if (total > 6000) throw new EmbedError('Embeds may hold at most 6000 characters in all');
  return out;
}
