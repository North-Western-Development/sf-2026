import { memo } from 'react';
import data from './emoji-data.json';
import sheetUrl from 'emoji-datasource-twitter/img/twitter/sheets-256/64.png?url';

/**
 * Twemoji (the set Discord draws) from one sprite sheet: every emoji is a background position
 * on a single cached image, so the picker paints ~1,900 of them without per-emoji requests,
 * and flags render on systems whose emoji font has none (Windows).
 * Data: scripts/make-emoji-data.mjs.
 */

type Tone = [string, number, number];
type Row = [string, string, string[], number, number, number, Record<string, Tone>?];

export interface EmojiEntry {
  emoji: string;
  /** Primary shortcode, e.g. "grinning". */
  slug: string;
  aliases: string[];
  category: number;
  x: number;
  y: number;
  tones?: Record<number, { emoji: string; x: number; y: number }>;
}

export const EMOJI_CATEGORIES: string[] = data.categories;
const CELL = 66; // 64px image + 1px padding each side
const SHEET = data.sheetSize * CELL;

export const EMOJI: EmojiEntry[] = (data.emoji as unknown as Row[]).map(([emoji, slug, aliases, category, x, y, tones]) => ({
  emoji,
  slug,
  aliases,
  category,
  x,
  y,
  tones: tones ? Object.fromEntries(Object.entries(tones).map(([t, [e, tx, ty]]) => [Number(t), { emoji: e, x: tx, y: ty }])) : undefined,
}));

/** Looks up an emoji (or a skin-tone variant) by its characters, with or without U+FE0F. */
const strip = (s: string) => s.replace(/️/g, '');
const BY_CHARS = new Map<string, { entry: EmojiEntry; x: number; y: number }>();
for (const e of EMOJI) {
  BY_CHARS.set(strip(e.emoji), { entry: e, x: e.x, y: e.y });
  for (const t of Object.values(e.tones ?? {})) BY_CHARS.set(strip(t.emoji), { entry: e, x: t.x, y: t.y });
}
export const findEmoji = (chars: string) => BY_CHARS.get(strip(chars));
export const BY_SLUG = new Map(EMOJI.flatMap((e) => [e.slug, ...e.aliases].map((s) => [s, e] as const)));

/** Shortcode lookup for the composer's ":" autocomplete. */
export const EMOJI_INDEX = EMOJI.map((e) => ({ emoji: e.emoji, slug: e.slug, name: e.slug.replace(/_/g, ' ') }));

/** CSS for drawing sheet cell (x, y) at `size` px. */
export function spriteStyle(x: number, y: number, size: number): React.CSSProperties {
  const scale = size / 64;
  return {
    width: size,
    height: size,
    backgroundImage: `url(${sheetUrl})`,
    backgroundSize: `${SHEET * scale}px ${SHEET * scale}px`,
    backgroundPosition: `${-(x * CELL + 1) * scale}px ${-(y * CELL + 1) * scale}px`,
  };
}

/** One emoji as a Twemoji image; falls back to the characters if the set lacks it. */
export const Emoji = memo(function Emoji({ emoji, size = 22, className }: { emoji: string; size?: number; className?: string }) {
  const hit = findEmoji(emoji);
  if (!hit) return <span className={className}>{emoji}</span>;
  return <span role="img" aria-label={`:${hit.entry.slug}:`} className={className} style={{ display: 'inline-block', verticalAlign: '-0.3em', margin: '0 0.05em 0 0.1em', ...spriteStyle(hit.x, hit.y, size) }} />;
});

/** Matches emoji sequences in text: flags, keycaps, and pictographs with modifiers / ZWJ joins. */
export const EMOJI_RE =
  /(\p{Regional_Indicator}\p{Regional_Indicator}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/gu;

/** Splits text into strings and Twemoji images. */
export function withTwemoji(text: string, size = 22, keyPrefix = 'e'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    if (!findEmoji(m[0])) continue;
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<Emoji key={`${keyPrefix}${i++}`} emoji={m[0]} size={size} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Starts downloading the sprite sheet early so the first picker opens fully drawn. */
export function preloadEmojiSheet() {
  const img = new Image();
  img.decoding = 'async';
  img.src = sheetUrl;
}

/** The sprite as plain CSS values, for DOM elements built outside React (the message editor). */
export function spriteCss(x: number, y: number, size: number) {
  const s = spriteStyle(x, y, size);
  return { backgroundImage: s.backgroundImage as string, backgroundSize: s.backgroundSize as string, backgroundPosition: s.backgroundPosition as string };
}
