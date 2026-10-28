import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronDown, Clock, Dog, Flag, Gamepad2, Heart, Lightbulb, Lock, Plane, Pizza, Search, Smile, Hand, X } from 'lucide-react';
import { GifPanel, StickerPanel, type Gif, type Sticker } from './ExpressionPanels';
import { useStore } from '../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { http, optional } from '../../lib/http';
import { EMOJI, EMOJI_CATEGORIES, findEmoji, spriteStyle, type EmojiEntry } from '../../lib/emoji';
import { rememberGlyphs } from './resolvers';

export { EMOJI_INDEX } from '../../lib/emoji';

const CATEGORY_ICON = [<Smile key="0" />, <Hand key="1" />, <Dog key="2" />, <Pizza key="3" />, <Gamepad2 key="4" />, <Plane key="5" />, <Lightbulb key="6" />, <Heart key="7" />, <Flag key="8" />];

export interface Glyph {
  id: string;
  name: string;
  url: string;
}

const RECENT_KEY = 'subspace_recent_emoji';
const TONE_KEY = 'subspace_emoji_tone';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
};
const pushRecent = (e: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, 27)));
  } catch {
    /* ignore */
  }
};
const CLOSE_KEY = 'subspace_emoji_close_after';
/** Close the picker after a pick (on unless turned off). */
const readCloseAfter = () => {
  try {
    return localStorage.getItem(CLOSE_KEY) !== '0';
  } catch {
    return true;
  }
};
const readTone = () => {
  try {
    return Number(localStorage.getItem(TONE_KEY)) || 0;
  } catch {
    return 0;
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

/** One cell: a Twemoji (with the chosen skin tone applied) or a glyph and its beacon. */
type Item = { kind: 'emoji'; entry: EmojiEntry; emoji: string; x: number; y: number } | { kind: 'glyph'; glyph: Glyph; beaconId: string; locked: boolean };
interface SectionData {
  key: string;
  title: string;
  icon: React.ReactNode;
  items: Item[];
  collapsible?: boolean;
}

const itemKey = (it: Item) => (it.kind === 'emoji' ? `e:${it.entry.slug}` : `g:${it.beaconId}:${it.glyph.id}`);
const toned = (entry: EmojiEntry, tone: number): Item => {
  const t = tone ? entry.tones?.[tone] : undefined;
  return { kind: 'emoji', entry, emoji: t?.emoji ?? entry.emoji, x: t?.x ?? entry.x, y: t?.y ?? entry.y };
};
const TONE_SAMPLE = EMOJI.find((e) => e.slug === 'clap')!;

/**
 * Discord-style emoji picker drawn from the Twemoji sprite sheet: search, a skin-tone
 * selector, a category rail (recent, each beacon's glyphs, the emoji groups), collapsible
 * beacon sections and a footer naming the hovered emoji. `onPick` receives a unicode emoji
 * or `custom:<glyphId>`.
 *
 * Glyphs the member may not use here (another beacon's without Use External Glyphs) are shown locked.
 * `glyphs="none"` (custom status) shows emoji only.
 */
export function EmojiPicker({
  anchor,
  beaconId,
  onPick,
  onClose,
  placement = 'auto',
  tabs = false,
  glyphs: glyphMode = 'current',
  initialTab = 'emoji',
  onSticker,
  onGif,
}: {
  anchor: DOMRect;
  beaconId?: string;
  onPick: (emoji: string, glyph?: Glyph) => void;
  onClose: () => void;
  placement?: 'auto' | 'above';
  /** Show the GIFs / Stickers / Emoji tabs (the composer). */
  tabs?: boolean;
  glyphs?: 'current' | 'none';
  /** With `tabs`: which tab opens first. */
  initialTab?: 'gifs' | 'stickers' | 'emoji';
  onSticker?: (s: Sticker) => void;
  onGif?: (g: Gif) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [glyphsByBeacon, setGlyphsByBeacon] = useState<Record<string, Glyph[]>>({});
  const [hovered, setHovered] = useState<Item | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string>('');
  const [tone, setTone] = useState(readTone);
  const [tonePicker, setTonePicker] = useState(false);
  const [closeAfter, setCloseAfter] = useState(readCloseAfter);
  const shiftHeld = useRef(false);
  const saveCloseAfter = (v: boolean) => {
    setCloseAfter(v);
    try {
      localStorage.setItem(CLOSE_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
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

  const q = query.trim().toLowerCase().replace(/^:|:$/g, '').replace(/\s+/g, '_');
  // In a beacon: its own glyphs need Use Signal Glyphs, other beacons' Use External Glyphs.
  const ownOk = useStore((s) => !beaconId || can(beaconPermissions(s, beaconId), PERMISSIONS.USE_SIGNAL_GLYPHS));
  const externalOk = useStore((s) => !beaconId || can(beaconPermissions(s, beaconId), PERMISSIONS.USE_EXTERNAL_GLYPHS));
  const sections = useMemo<SectionData[]>(() => {
    const glyphItem = (g: Glyph, bId: string): Item => ({ kind: 'glyph', glyph: g, beaconId: bId, locked: bId === beaconId ? !ownOk : !externalOk });
    const out: SectionData[] = [];
    if (!q && recent.length) {
      const items = recent
        .map<Item | null>((r) => {
          if (!r.startsWith('custom:')) {
            const hit = findEmoji(r);
            return hit ? { kind: 'emoji', entry: hit.entry, emoji: r, x: hit.x, y: hit.y } : null;
          }
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
    EMOJI_CATEGORIES.forEach((title, ci) => {
      const list = EMOJI.filter((e) => e.category === ci && (!q || e.slug.includes(q) || e.aliases.some((a) => a.includes(q))));
      if (list.length) out.push({ key: `cat:${ci}`, title, icon: CATEGORY_ICON[ci], items: list.map((e) => toned(e, tone)) });
    });
    return out;
  }, [q, recent, beaconList, glyphsByBeacon, beaconId, tone, ownOk, externalOk]);

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
      // Shift-click keeps the picker open either way, as in Discord.
      if (closeAfter && !shiftHeld.current) onClose();
    },
    [onPick, onClose, closeAfter]
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

  const chooseTone = (t: number) => {
    setTone(t);
    setTonePicker(false);
    try {
      localStorage.setItem(TONE_KEY, String(t));
    } catch {
      /* ignore */
    }
  };

  const toggle = useCallback((key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] })), []);
  const hoveredBeacon = hovered?.kind === 'glyph' ? beacons[hovered.beaconId]?.name : undefined;
  const sample = toned(TONE_SAMPLE, tone) as Extract<Item, { kind: 'emoji' }>;

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
        <div className="flex items-center gap-2 text-sm font-semibold">
          {tabs && (
            <div role="tablist" aria-label="Expression picker" className="flex gap-1">
              {([['gifs', 'GIFs', onGif], ['stickers', 'Stickers', onSticker], ['emoji', 'Emoji', true]] as const)
                .filter(([, , on]) => on)
                .map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={clsx('rounded-md px-3 py-1', tab === key ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
                  >
                    {label}
                  </button>
                ))}
            </div>
          )}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-medium text-fg-muted">
            Close after selecting
            <button
              type="button"
              role="switch"
              aria-checked={closeAfter}
              aria-label="Close after selecting"
              onClick={() => saveCloseAfter(!closeAfter)}
              className={clsx('relative h-5 w-8 shrink-0 rounded-full transition-colors', closeAfter ? 'bg-brand' : 'bg-fg-disabled')}
            >
              <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', closeAfter ? 'left-[14px]' : 'left-0.5')} />
            </button>
          </label>
        </div>
        {tab === 'emoji' && (
        <div className="relative flex items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md bg-void px-2.5 ring-1 ring-transparent focus-within:ring-brand-sky">
            <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={hovered ? `:${hovered.kind === 'glyph' ? hovered.glyph.name : hovered.entry.slug}:` : 'Find the perfect emoji'}
              aria-label="Search emoji"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-fg-subtle hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          <button type="button" aria-label="Skin tone" aria-expanded={tonePicker} onClick={() => setTonePicker((v) => !v)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-hover">
            <span style={spriteStyle(sample.x, sample.y, 24)} />
          </button>
          {tonePicker && (
            <div role="listbox" aria-label="Skin tones" className="absolute right-0 top-10 z-20 flex flex-col gap-0.5 rounded-lg bg-overlay p-1 shadow-pop ring-1 ring-line">
              {[0, 1, 2, 3, 4, 5].map((t) => {
                const s = toned(TONE_SAMPLE, t) as Extract<Item, { kind: 'emoji' }>;
                return (
                  <button key={t} type="button" role="option" aria-selected={tone === t} aria-label={t ? `Skin tone ${t}` : 'Default skin tone'} onClick={() => chooseTone(t)} className={clsx('flex h-9 w-9 items-center justify-center rounded-md hover:bg-hover', tone === t && 'bg-active')}>
                    <span style={spriteStyle(s.x, s.y, 24)} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>

      {tab === 'stickers' && onSticker ? (
        <StickerPanel
          onPick={(s) => {
            onSticker(s);
            onClose();
          }}
        />
      ) : tab === 'gifs' && onGif ? (
        <GifPanel
          onPick={(g) => {
            onGif(g);
            onClose();
          }}
        />
      ) : (
      <>
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
            shiftHeld.current = e.shiftKey;
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
            {hovered.kind === 'glyph' ? <img src={hovered.glyph.url} alt="" className="h-7 w-7 object-contain" /> : <span style={spriteStyle(hovered.x, hovered.y, 28)} />}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">:{hovered.kind === 'glyph' ? hovered.glyph.name : hovered.entry.slug}:</span>
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
      </>
      )}
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
                    <button key={it.entry.slug} type="button" data-k={itemKey(it)} aria-label={it.entry.slug.replace(/_/g, ' ')} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-hover">
                      <span style={spriteStyle(it.x, it.y, 32)} />
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
