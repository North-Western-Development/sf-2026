import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Search, Clock } from 'lucide-react';
import groups from 'unicode-emoji-json/data-by-group.json';
import { useStore } from '../../data/store';
import { http, optional } from '../../lib/http';
import { rememberGlyphs } from './resolvers';

type Group = { name: string; slug: string; emojis: Array<{ emoji: string; name: string; slug: string }> };
const GROUPS = (groups as Group[]).filter((g) => g.slug !== 'component');

export interface Glyph {
  id: string;
  name: string;
  url: string;
}

const RECENT_KEY = 'subspace_recent_emoji';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
};
const pushRecent = (e: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, 24)));
  } catch {
    /* ignore */
  }
};

/** Glyphs per beacon, loaded lazily. */
const glyphCache = new Map<string, Glyph[]>();
export async function loadGlyphs(beaconId: string): Promise<Glyph[]> {
  if (glyphCache.has(beaconId)) return glyphCache.get(beaconId)!;
  const res = await optional(http.get<{ emojis: Glyph[] }>(`/beacons/${beaconId}/emojis`), { emojis: [] });
  glyphCache.set(beaconId, res.emojis);
  rememberGlyphs(res.emojis);
  return res.emojis;
}

/** Shortcode lookup used by the composer's ":" autocomplete. */
export const EMOJI_INDEX = GROUPS.flatMap((g) => g.emojis.map((e) => ({ emoji: e.emoji, slug: e.slug, name: e.name })));

/**
 * Emoji picker popover. `onPick` receives a unicode emoji or `custom:<glyphId>` for reactions;
 * composers use `onPickText` to get insertable text (`<:name:id>` for glyphs).
 */
export function EmojiPicker({
  anchor,
  beaconId,
  onPick,
  onClose,
  placement = 'auto',
}: {
  anchor: DOMRect;
  beaconId?: string;
  onPick: (emoji: string, glyph?: Glyph) => void;
  onClose: () => void;
  placement?: 'auto' | 'above';
}) {
  const [query, setQuery] = useState('');
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [hovered, setHovered] = useState<{ label: string; preview: React.ReactNode } | null>(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999 });
  const ref = useRef<HTMLDivElement>(null);
  const beaconName = useStore((s) => (beaconId ? s.beacons[beaconId]?.name : undefined));
  const recent = useMemo(readRecent, []);

  useEffect(() => {
    if (beaconId) void loadGlyphs(beaconId).then(setGlyphs);
  }, [beaconId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = anchor.right - w;
    let y = placement === 'above' || anchor.bottom + h > window.innerHeight - 8 ? anchor.top - h - 8 : anchor.bottom + 8;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    setPos({ x, y });
  }, [anchor, placement]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase().replace(/^:|:$/g, '');
  const filteredGlyphs = glyphs.filter((g) => !q || g.name.toLowerCase().includes(q));
  const filteredGroups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, emojis: q ? g.emojis.filter((e) => e.slug.includes(q) || e.name.includes(q)) : g.emojis })).filter((g) => g.emojis.length),
    [q]
  );

  const pick = (emoji: string, glyph?: Glyph) => {
    pushRecent(glyph ? `custom:${glyph.id}` : emoji);
    onPick(glyph ? `custom:${glyph.id}` : emoji, glyph);
  };

  const cell = 'flex h-10 w-10 items-center justify-center rounded-md hover:bg-hover';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      data-context-menu
      className="fixed z-[1500] flex h-[440px] w-[400px] flex-col overflow-hidden rounded-xl bg-overlay shadow-pop animate-[fade-in_80ms_ease-out]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="p-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md bg-void px-2">
          <Search className="h-4 w-4 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find the perfect emoji"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {!q && recent.length > 0 && (
          <Section title="Frequently Used" icon={<Clock className="h-3.5 w-3.5" />}>
            {recent.map((e) => {
              if (e.startsWith('custom:')) {
                const g = glyphs.find((x) => x.id === e.slice(7));
                return g ? (
                  <button key={e} className={cell} aria-label={`:${g.name}:`} onClick={() => pick('', g)}>
                    <img src={g.url} alt="" className="h-7 w-7 object-contain" />
                  </button>
                ) : null;
              }
              return (
                <button key={e} className={clsx(cell, 'text-2xl')} aria-label={e} onClick={() => pick(e)}>
                  {e}
                </button>
              );
            })}
          </Section>
        )}
        {filteredGlyphs.length > 0 && (
          <Section title={beaconName ?? 'Signal Glyphs'}>
            {filteredGlyphs.map((g) => (
              <button
                key={g.id}
                className={cell}
                aria-label={`:${g.name}:`}
                onClick={() => pick('', g)}
                onMouseEnter={() => setHovered({ label: `:${g.name}:`, preview: <img src={g.url} alt="" className="h-8 w-8 object-contain" /> })}
              >
                <img src={g.url} alt="" className="h-7 w-7 object-contain" loading="lazy" />
              </button>
            ))}
          </Section>
        )}
        {filteredGroups.map((g) => (
          <Section key={g.slug} title={g.name}>
            {g.emojis.map((e) => (
              <button
                key={e.slug}
                className={clsx(cell, 'text-2xl')}
                aria-label={e.name}
                onClick={() => pick(e.emoji)}
                onMouseEnter={() => setHovered({ label: `:${e.slug}:`, preview: <span className="text-3xl">{e.emoji}</span> })}
              >
                {e.emoji}
              </button>
            ))}
          </Section>
        ))}
        {!filteredGroups.length && !filteredGlyphs.length && <p className="py-10 text-center text-sm text-fg-subtle">No emoji match “{query}”.</p>}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-3 border-t border-line bg-raised px-4">
        {hovered ? (
          <>
            {hovered.preview}
            <span className="truncate text-sm font-semibold text-fg">{hovered.label}</span>
          </>
        ) : (
          <span className="text-sm text-fg-subtle">Pick an emoji</span>
        )}
      </div>
    </div>,
    document.body
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pb-2">
      <h4 className="sticky top-0 z-10 flex items-center gap-1.5 bg-overlay py-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {icon}
        {title}
      </h4>
      <div className="grid grid-cols-8">{children}</div>
    </section>
  );
}
