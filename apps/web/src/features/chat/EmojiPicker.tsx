import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronDown, Clock, Dog, Flag, Gamepad2, Heart, Lightbulb, Lock, Plane, Pizza, Search, Smile, Hand, X } from 'lucide-react';
import { ComingSoon } from '@subspace/ui';
import groups from 'unicode-emoji-json/data-by-group.json';
import { useStore } from '../../data/store';
import { http, optional } from '../../lib/http';
import { rememberGlyphs } from './resolvers';

type Group = { name: string; slug: string; emojis: Array<{ emoji: string; name: string; slug: string }> };
const GROUPS = (groups as Group[]).filter((g) => g.slug !== 'component');

const GROUP_ICON: Record<string, React.ReactNode> = {
  smileys_emotion: <Smile />,
  people_body: <Hand />,
  animals_nature: <Dog />,
  food_drink: <Pizza />,
  travel_places: <Plane />,
  activities: <Gamepad2 />,
  objects: <Lightbulb />,
  symbols: <Heart />,
  flags: <Flag />,
};

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
const BY_EMOJI = new Map(EMOJI_INDEX.map((e) => [e.emoji, e]));

/** One cell's identity: a unicode emoji, or a glyph and the beacon it belongs to. */
type Item = { kind: 'emoji'; emoji: string; slug: string } | { kind: 'glyph'; glyph: Glyph; beaconId: string; locked: boolean };
interface SectionData {
  key: string;
  title: string;
  icon: React.ReactNode;
  items: Item[];
  collapsible?: boolean;
}

const itemKey = (it: Item) => (it.kind === 'emoji' ? `e:${it.emoji}` : `g:${it.beaconId}:${it.glyph.id}`);

/**
 * Discord-style emoji picker: search, a category rail (recent, each beacon's glyphs, the
 * unicode groups), collapsible beacon sections and a footer naming the hovered emoji.
 * `onPick` receives a unicode emoji or `custom:<glyphId>`.
 *
 * Glyphs from other beacons are shown but locked: a beacon only accepts its own glyphs.
 * `glyphs="none"` (custom status) shows unicode only.
 */
export function EmojiPicker({
  anchor,
  beaconId,
  onPick,
  onClose,
  placement = 'auto',
  tabs = false,
  glyphs: glyphMode = 'current',
}: {
  anchor: DOMRect;
  beaconId?: string;
  onPick: (emoji: string, glyph?: Glyph) => void;
  onClose: () => void;
  placement?: 'auto' | 'above';
  /** Show the GIFs / Stickers / Emoji tabs (the composer). */
  tabs?: boolean;
  glyphs?: 'current' | 'none';
}) {
  const [query, setQuery] = useState('');
  const [glyphsByBeacon, setGlyphsByBeacon] = useState<Record<string, Glyph[]>>({});
  const [hovered, setHovered] = useState<Item | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string>('');
  const [pos, setPos] = useState({ x: -9999, y: -9999 });
  const ref = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const beacons = useStore((s) => s.beacons);
  const recent = useMemo(readRecent, []);

  // The current beacon first, then the rest by name.
  const beaconList = useMemo(() => {
    if (glyphMode === 'none') return [];
    const list = Object.values(beacons).sort((a, b) => a.name.localeCompare(b.name));
    return beaconId ? [...list.filter((b) => b.id === beaconId), ...list.filter((b) => b.id !== beaconId)] : list;
  }, [beacons, beaconId, glyphMode]);

  useEffect(() => {
    let cancelled = false;
    for (const b of beaconList) {
      void loadGlyphs(b.id).then((g) => {
        if (!cancelled && g.length) setGlyphsByBeacon((cur) => (cur[b.id] ? cur : { ...cur, [b.id]: g }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [beaconList]);

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
  const sections = useMemo<SectionData[]>(() => {
    const glyphItem = (g: Glyph, bId: string): Item => ({ kind: 'glyph', glyph: g, beaconId: bId, locked: bId !== beaconId });
    const out: SectionData[] = [];
    if (!q && recent.length) {
      const items = recent
        .map<Item | null>((r) => {
          if (!r.startsWith('custom:')) return BY_EMOJI.has(r) ? { kind: 'emoji', emoji: r, slug: BY_EMOJI.get(r)!.slug } : null;
          for (const b of beaconList) {
            const g = glyphsByBeacon[b.id]?.find((x) => x.id === r.slice(7));
            if (g) return glyphItem(g, b.id);
          }
          return null;
        })
        .filter((x): x is Item => !!x);
      if (items.length) out.push({ key: 'recent', title: 'Frequently Used', icon: <Clock />, items });
    }
    for (const b of beaconList) {
      const list = (glyphsByBeacon[b.id] ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
      if (list.length) out.push({ key: `beacon:${b.id}`, title: b.name, icon: <BeaconIcon name={b.name} iconUrl={b.iconUrl} />, items: list.map((g) => glyphItem(g, b.id)), collapsible: true });
    }
    for (const g of GROUPS) {
      const list = q ? g.emojis.filter((e) => e.slug.includes(q) || e.name.includes(q)) : g.emojis;
      if (list.length) out.push({ key: g.slug, title: g.name, icon: GROUP_ICON[g.slug] ?? <Smile />, items: list.map((e) => ({ kind: 'emoji', emoji: e.emoji, slug: e.slug })) });
    }
    return out;
  }, [q, recent, beaconList, glyphsByBeacon, beaconId]);

  const byKey = useMemo(() => {
    const m = new Map<string, Item>();
    for (const s of sections) for (const it of s.items) m.set(itemKey(it), it);
    return m;
  }, [sections]);

  const pick = useCallback(
    (it: Item) => {
      if (it.kind === 'glyph') {
        if (it.locked) return;
        pushRecent(`custom:${it.glyph.id}`);
        onPick(`custom:${it.glyph.id}`, it.glyph);
      } else {
        pushRecent(it.emoji);
        onPick(it.emoji);
      }
    },
    [onPick]
  );

  // One listener for the whole grid instead of one per cell.
  const itemFrom = (target: EventTarget) => {
    const k = (target as HTMLElement).closest?.('[data-k]')?.getAttribute('data-k');
    return k ? byKey.get(k) ?? null : null;
  };

  const jump = (key: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-section="${CSS.escape(key)}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop;
    setActive(key);
  };
  const spy = () => {
    const box = scroller.current;
    if (!box) return;
    let current = '';
    for (const el of box.querySelectorAll<HTMLElement>('[data-section]')) {
      if (el.offsetTop - box.scrollTop <= 8) current = el.dataset.section!;
      else break;
    }
    setActive(current || sections[0]?.key || '');
  };

  const toggle = useCallback((key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] })), []);
  const hoveredBeacon = hovered?.kind === 'glyph' ? beacons[hovered.beaconId]?.name : undefined;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      data-context-menu
      className="fixed z-[1500] flex h-[460px] w-[440px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl bg-overlay shadow-pop ring-1 ring-line animate-[fade-in_80ms_ease-out]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="shrink-0 space-y-3 border-b border-line p-3">
        {tabs && (
          <div className="flex gap-2 text-sm font-semibold">
            <ComingSoon label="GIFs">
              <span className="rounded-md px-3 py-1 text-fg-muted">GIFs</span>
            </ComingSoon>
            <ComingSoon label="Stickers">
              <span className="rounded-md px-3 py-1 text-fg-muted">Stickers</span>
            </ComingSoon>
            <span className="rounded-md bg-active px-3 py-1 text-fg">Emoji</span>
          </div>
        )}
        <label className="flex h-9 items-center gap-2 rounded-md bg-void px-2.5 ring-1 ring-transparent focus-within:ring-brand-sky">
          <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={hovered ? `:${hovered.kind === 'glyph' ? hovered.glyph.name : hovered.slug}:` : 'Find the perfect emoji'}
            aria-label="Search emoji"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-fg-subtle hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Emoji categories" className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-raised py-2 [scrollbar-width:none]">
          {sections.map((s, i) => (
            <div key={s.key} className="contents">
              {i > 0 && sections[i - 1].key.startsWith('beacon:') && !s.key.startsWith('beacon:') && <span className="my-1 h-px w-6 bg-line" />}
              <button
                type="button"
                aria-label={s.title}
                title={s.title}
                onClick={() => jump(s.key)}
                className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg [&>svg]:h-5 [&>svg]:w-5',
                  active === s.key && 'bg-active text-fg'
                )}
              >
                {s.icon}
              </button>
            </div>
          ))}
        </nav>

        <div
          ref={scroller}
          onScroll={spy}
          onClick={(e) => {
            const it = itemFrom(e.target);
            if (it) pick(it);
          }}
          onMouseOver={(e) => {
            const it = itemFrom(e.target);
            if (it && it !== hovered) setHovered(it);
          }}
          className="relative min-h-0 flex-1 overflow-y-auto px-2"
        >
          <Sections sections={sections} collapsed={collapsed} onToggle={toggle} beacons={beacons} />
          {!sections.length && <p className="py-10 text-center text-sm text-fg-subtle">No emoji match “{query}”.</p>}
        </div>
      </div>

      <div className="flex h-12 shrink-0 items-center gap-3 border-t border-line bg-raised px-4">
        {hovered ? (
          <>
            {hovered.kind === 'glyph' ? <img src={hovered.glyph.url} alt="" className="h-7 w-7 object-contain" /> : <span className="text-2xl leading-none">{hovered.emoji}</span>}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">:{hovered.kind === 'glyph' ? hovered.glyph.name : hovered.slug}:</span>
              {hoveredBeacon && (
                <span className="block truncate text-xs text-fg-muted">
                  {hovered.kind === 'glyph' && hovered.locked ? 'Only usable in ' : 'from '}
                  <span className="font-semibold text-fg">{hoveredBeacon}</span>
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-sm text-fg-subtle">Pick an emoji</span>
        )}
      </div>
    </div>,
    document.body
  );
}

function BeaconIcon({ name, iconUrl }: { name: string; iconUrl?: string | null }) {
  return iconUrl ? (
    <img src={iconUrl} alt="" className="!h-6 !w-6 rounded-full object-cover" />
  ) : (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-overlay text-[10px] font-bold text-fg">{name.slice(0, 2).toUpperCase()}</span>
  );
}

/** The grid. Memoized so hovering (which only changes the footer) does not re-render ~1,900 cells. */
const Sections = memo(function Sections({
  sections,
  collapsed,
  onToggle,
  beacons,
}: {
  sections: SectionData[];
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  beacons: Record<string, { name: string }>;
}) {
  return (
    <>
      {sections.map((s) => {
        const closed = s.collapsible && collapsed[s.key];
        const rows = Math.ceil(s.items.length / 9);
        return (
          <section
            key={s.key}
            data-section={s.key}
            aria-label={s.title}
            // Off-screen sections skip layout and paint until scrolled near.
            style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${closed ? 36 : rows * 44 + 36}px` }}
          >
            <h4 className="sticky top-0 z-10 flex h-9 items-center gap-1.5 bg-overlay text-xs font-semibold text-fg-muted [&>svg]:h-4 [&>svg]:w-4">
              <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4 [&_img]:!h-4 [&_img]:!w-4 [&>span]:h-4 [&>span]:w-4 [&>span]:text-[7px]">{s.icon}</span>
              {s.collapsible ? (
                <button type="button" onClick={() => onToggle(s.key)} aria-expanded={!closed} className="flex items-center gap-1 hover:text-fg">
                  {s.title}
                  <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', closed && '-rotate-90')} />
                </button>
              ) : (
                s.title
              )}
            </h4>
            {!closed && (
              <div className="grid grid-cols-9 pb-2">
                {s.items.map((it) =>
                  it.kind === 'emoji' ? (
                    <button key={it.emoji} type="button" data-k={itemKey(it)} aria-label={it.slug.replace(/_/g, ' ')} className="flex h-11 w-11 items-center justify-center rounded-md text-[28px] leading-none hover:bg-hover">
                      {it.emoji}
                    </button>
                  ) : (
                    <button
                      key={it.glyph.id}
                      type="button"
                      data-k={itemKey(it)}
                      aria-label={`:${it.glyph.name}:`}
                      aria-disabled={it.locked || undefined}
                      title={it.locked ? `Only usable in ${beacons[it.beaconId]?.name ?? 'its beacon'}` : undefined}
                      className={clsx('relative flex h-11 w-11 items-center justify-center rounded-md hover:bg-hover', it.locked && 'cursor-not-allowed')}
                    >
                      <img src={it.glyph.url} alt="" loading="lazy" className={clsx('h-8 w-8 object-contain', it.locked && 'opacity-40 grayscale')} />
                      {it.locked && <Lock className="absolute bottom-1 right-1 h-3 w-3 text-fg-muted" aria-hidden />}
                    </button>
                  )
                )}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
});
