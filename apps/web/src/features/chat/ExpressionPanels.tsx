import { useEffect, useMemo, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { clsx } from 'clsx';
import { create } from 'zustand';
import { http, ApiError } from '../../lib/http';
import { toast } from '../../app/ui';
import { term } from '../../lib/strings';

export interface Sticker {
  id: string;
  beaconId: string;
  name: string;
  description: string | null;
  emoji: string;
  url: string;
}
export interface Gif {
  url: string;
  preview: string;
  width: number;
  height: number;
  title?: string;
}

// ---------------------------------------------------------------------------
// Stickers
// ---------------------------------------------------------------------------

type Pack = { beacon: { id: string; name: string; iconUrl: string | null }; stickers: Sticker[] };
let packsCache: Pack[] | null = null;
/** Drop the cached sticker packs (a beacon's stickers changed). */
export const invalidateStickers = () => (packsCache = null);

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-md bg-void px-2.5 ring-1 ring-transparent focus-within:ring-brand-sky">
      <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="text-fg-subtle hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}

/** Stickers from every beacon you are in, by beacon (Discord's sticker picker). */
export function StickerPanel({ onPick }: { onPick: (s: Sticker) => void }) {
  const [packs, setPacks] = useState<Pack[] | null>(packsCache);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (packsCache) return;
    http
      .get<{ packs: Pack[] }>('/users/@me/stickers')
      .then((r) => setPacks((packsCache = r.packs)))
      .catch(() => setPacks([]));
  }, []);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (packs ?? []).map((p) => ({ ...p, stickers: p.stickers.filter((s) => !q || s.name.toLowerCase().includes(q) || s.emoji === query.trim()) })).filter((p) => p.stickers.length),
    [packs, q, query]
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <SearchBox value={query} onChange={setQuery} placeholder="Find stickers" label="Search stickers" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {packs === null && <p className="text-sm text-fg-subtle">Loading…</p>}
        {packs && !packs.length && (
          <p className="py-10 text-center text-sm text-fg-subtle">
            None of your {term('beacon', true).toLowerCase()} have stickers yet. Admins add them in {term('beacon')} Settings › Stickers.
          </p>
        )}
        {packs && packs.length > 0 && !shown.length && <p className="py-10 text-center text-sm text-fg-subtle">No stickers match “{query}”.</p>}
        {shown.map((p) => (
          <section key={p.beacon.id} aria-label={p.beacon.name} className="mb-3">
            <h4 className="mb-1 text-xs font-semibold uppercase text-fg-muted">{p.beacon.name}</h4>
            <div className="grid grid-cols-4 gap-1">
              {p.stickers.map((s) => (
                <button key={s.id} type="button" aria-label={`Sticker ${s.name}`} title={s.name} onClick={() => onPick(s)} className="flex aspect-square items-center justify-center rounded-md p-1 hover:bg-hover">
                  <img src={s.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GIFs
// ---------------------------------------------------------------------------

interface Favorite extends Gif {
  id: string;
  previewUrl: string;
}

/** Starred GIFs, shared by the picker and the star on GIFs in chat. */
export const useGifFavorites = create<{ list: Favorite[] | null }>()(() => ({ list: null }));
export async function loadGifFavorites() {
  if (useGifFavorites.getState().list) return;
  const r = await http.get<{ favorites: Array<Favorite & { previewUrl: string }> }>('/users/@me/gif-favorites').catch(() => ({ favorites: [] }));
  useGifFavorites.setState({ list: r.favorites.map((f) => ({ ...f, preview: f.previewUrl })) });
}
export async function toggleGifFavorite(g: Gif) {
  await loadGifFavorites();
  const list = useGifFavorites.getState().list ?? [];
  const existing = list.find((f) => f.url === g.url);
  if (existing) {
    useGifFavorites.setState({ list: list.filter((f) => f !== existing) });
    await http.delete(`/users/@me/gif-favorites/${existing.id}`).catch(() => undefined);
    return false;
  }
  const res = await http.post<{ favorite: Favorite & { previewUrl: string } }>('/users/@me/gif-favorites', { url: g.url, previewUrl: g.preview, width: g.width, height: g.height });
  useGifFavorites.setState({ list: [{ ...res.favorite, preview: res.favorite.previewUrl }, ...list] });
  return true;
}

function GifTile({ g, onPick }: { g: Gif; onPick: (g: Gif) => void }) {
  const fav = useGifFavorites((s) => !!s.list?.some((f) => f.url === g.url));
  return (
    <div className="group relative mb-1 break-inside-avoid overflow-hidden rounded-md">
      <button type="button" aria-label={g.title ? `GIF ${g.title}` : 'GIF'} onClick={() => onPick(g)} className="block w-full">
        <img src={g.preview} alt="" loading="lazy" className="w-full bg-void" style={{ aspectRatio: `${g.width || 1} / ${g.height || 1}` }} />
      </button>
      <button
        type="button"
        aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={fav}
        onClick={() => void toggleGifFavorite(g).catch((e) => toast((e as Error).message, 'error'))}
        className={clsx('absolute right-1 top-1 rounded-md bg-void/70 p-1 transition-opacity', fav ? 'text-star opacity-100' : 'text-fg opacity-0 group-hover:opacity-100')}
      >
        <Star className="h-4 w-4" fill={fav ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

/** GIF search (GIPHY, when the server has it set up), trending, and your favorites. */
export function GifPanel({ onPick }: { onPick: (g: Gif) => void }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'home' | 'favorites'>('home');
  const [gifs, setGifs] = useState<Gif[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const favorites = useGifFavorites((s) => s.list);
  useEffect(() => void loadGifFavorites(), []);
  useEffect(() => {
    setGifs(null);
    const t = setTimeout(() => {
      http
        .get<{ gifs: Gif[] }>(query.trim() ? `/gifs/search?q=${encodeURIComponent(query.trim())}` : '/gifs/trending')
        .then((r) => {
          setGifs(r.gifs);
          setUnavailable(null);
        })
        .catch((e) => {
          setGifs([]);
          setUnavailable(e instanceof ApiError && e.code === 'GIFS_NOT_CONFIGURED' ? 'GIF search is not set up on this server. Your favorites still work.' : 'GIF search is unavailable right now.');
        });
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const list = view === 'favorites' && !query ? favorites ?? [] : gifs ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <SearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            if (v) setView('home');
          }}
          placeholder="Search GIPHY"
          label="Search GIFs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!query && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(['home', 'favorites'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={clsx('flex h-16 items-center justify-center gap-2 rounded-md text-sm font-semibold', view === v ? 'bg-brand text-on-brand' : 'bg-raised text-fg hover:bg-hover')}
              >
                {v === 'favorites' ? <><Star className="h-4 w-4" /> Favorites</> : 'Trending GIFs'}
              </button>
            ))}
          </div>
        )}
        {unavailable && view === 'home' && <p className="mb-2 text-sm text-fg-subtle">{unavailable}</p>}
        {view === 'favorites' && !query && favorites?.length === 0 && <p className="py-6 text-center text-sm text-fg-subtle">Star a GIF to keep it here.</p>}
        <div className="columns-2 gap-1">
          {list.map((g) => (
            <GifTile key={g.url} g={g} onPick={onPick} />
          ))}
        </div>
        {!unavailable && view === 'home' && gifs !== null && <p className="mt-2 text-center text-[10px] uppercase tracking-wide text-fg-subtle">Powered by GIPHY</p>}
      </div>
    </div>
  );
}
