import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { AtSign, ChevronLeft, ChevronRight, Hash, Search as SearchIcon, SearchX, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type SubspaceState } from '../../data/store';
import { http, ApiError } from '../../lib/http';
import { toTransmission, userTag } from '../../lib/normalize';
import { channelKey, type ChannelType, type Transmission, type UserRef } from '../../lib/types';
import { activeToken, filterToken, hasSearchTerms, parseSearch, SEARCH_FILTERS, toSearchParams, HAS_VALUES } from '../../lib/searchQuery';
import { useUi, type SearchState } from '../../app/ui';
import { formatMessageTime } from '../../lib/time';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from '../chat/markdown';
import { useMarkdownResolvers } from '../chat/resolvers';
import { Attachments } from '../chat/MessageItem';

const PAGE_SIZE = 25;

/** Pilots that can be named in from: / mentions: for a search scope. */
function scopeUsers(s: SubspaceState, scope: string): UserRef[] {
  if (scope !== 'dms') return Object.values(s.members[scope] ?? {}).map((m) => m.user);
  const seen = new Map<string, UserRef>();
  if (s.me) seen.set(s.me.id, s.me);
  for (const l of Object.values(s.links)) seen.set(l.recipient.id, l.recipient);
  for (const m of Object.values(s.meshes)) for (const u of m.members) seen.set(u.id, u);
  return [...seen.values()];
}

function matchUser(users: UserRef[], name: string): UserRef | null {
  const n = name.replace(/^@/, '').toLowerCase();
  return (
    users.find((u) => userTag(u).toLowerCase() === n) ??
    users.find((u) => u.username.toLowerCase() === n) ??
    users.find((u) => (u.displayName ?? '').toLowerCase() === n) ??
    null
  );
}

function scopeRelays(s: SubspaceState, scope: string) {
  if (scope === 'dms') return [];
  return (s.relayIdsByBeacon[scope] ?? []).map((id) => s.relays[id]).filter((r) => r && (r.type === 'text' || r.type === 'archival'));
}

type Suggestion = { label: string; detail?: string; insert: string; user?: UserRef; icon?: React.ReactNode };

/** Header search field. Enter runs the search in the side panel; filters autocomplete like Discord's. */
export function SearchBar({ scope }: { scope: string }) {
  const search = useUi((s) => (s.search?.scope === scope ? s.search : null));
  const [value, setValue] = useState(search?.query ?? '');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const users = useStore(useShallow((s) => scopeUsers(s, scope)));
  const relays = useStore(useShallow((s) => scopeRelays(s, scope)));

  useEffect(() => setValue(search?.query ?? ''), [search?.query, scope]);

  const token = activeToken(value, caret);
  const suggestions = useMemo<Suggestion[]>(() => {
    const v = token.value.toLowerCase();
    if (token.key === 'from' || token.key === 'mentions') {
      return users
        .filter((u) => !v || u.username.toLowerCase().includes(v) || (u.displayName ?? '').toLowerCase().includes(v))
        .slice(0, 8)
        .map((u) => ({ label: u.displayName || u.username, detail: userTag(u), insert: filterToken(token.key!, userTag(u)), user: u }));
    }
    if (token.key === 'has') {
      return HAS_VALUES.filter((h) => h.startsWith(v)).map((h) => ({ label: h, insert: `has:${h}` }));
    }
    if (token.key === 'in') {
      return relays
        .filter((r) => r.name.toLowerCase().includes(v.replace(/^#/, '')))
        .slice(0, 8)
        .map((r) => ({ label: r.name, insert: filterToken('in', r.name), icon: <Hash className="h-4 w-4" /> }));
    }
    if (token.key === 'pinned') return [{ label: 'true', insert: 'pinned:true' }];
    if (token.key) return [];
    return SEARCH_FILTERS.filter((f) => (!('beaconOnly' in f) || scope !== 'dms') && f.key.startsWith(v)).map((f) => ({
      label: `${f.key}:`,
      detail: f.hint,
      insert: `${f.key}:`,
    }));
  }, [token.key, token.value, users, relays, scope]);

  useEffect(() => setActive(0), [token.key, token.value]);

  const submit = (q = value) => {
    const parsed = parseSearch(q);
    if (!hasSearchTerms(parsed)) return;
    useUi.setState({ search: { scope, query: q.trim(), sort: search?.sort ?? 'newest', page: 0 } });
    input.current?.blur();
  };

  const pick = (s: Suggestion) => {
    const next = value.slice(0, token.start) + s.insert + (s.insert.endsWith(':') ? '' : ' ') + value.slice(caret).trimStart();
    setValue(next);
    const pos = token.start + s.insert.length + (s.insert.endsWith(':') ? 0 : 1);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const clear = () => {
    setValue('');
    useUi.setState({ search: null });
  };

  const showPopout = focused && suggestions.length > 0;
  const rect = box.current?.getBoundingClientRect();
  const expanded = focused || !!value;

  return (
    <div ref={box} className={clsx('relative transition-[width] duration-150', expanded ? 'w-60' : 'w-36')}>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search"
        aria-expanded={showPopout}
        aria-controls="search-options"
        aria-autocomplete="list"
        value={value}
        placeholder="Search"
        onChange={(e) => {
          setValue(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && showPopout) {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp' && showPopout) {
            e.preventDefault();
            setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Tab' && showPopout) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            // A half-typed filter completes first; otherwise run the search.
            if (showPopout && token.key && token.value !== suggestions[active]?.insert.split(':')[1]) pick(suggestions[active]);
            else submit();
          } else if (e.key === 'Escape') {
            input.current?.blur();
          }
        }}
        className="h-6 w-full rounded-sm bg-void pl-1.5 pr-6 text-sm text-fg placeholder:text-fg-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={clear} className="absolute right-1 top-1 text-fg-muted hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      ) : (
        <SearchIcon className="pointer-events-none absolute right-1.5 top-1.5 h-3.5 w-3.5 text-fg-subtle" />
      )}
      {showPopout &&
        rect &&
        createPortal(
          <div
            id="search-options"
            role="listbox"
            aria-label={token.key ? `${token.key} suggestions` : 'Search options'}
            data-context-menu
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-[1200] w-[320px] rounded-lg bg-overlay p-2 shadow-pop"
            style={{ top: rect.bottom + 8, left: Math.max(8, rect.right - 320) }}
          >
            <h3 className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {token.key === 'from' ? 'From User' : token.key === 'mentions' ? 'Mentions User' : token.key === 'in' ? 'In Relay' : token.key === 'has' ? 'Contains' : 'Search Options'}
            </h3>
            {suggestions.map((s, i) => (
              <button
                key={s.insert}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
                className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === active ? 'bg-hover text-fg' : 'text-fg-muted')}
              >
                {s.user ? <Avatar user={s.user} size={20} /> : s.icon}
                <span className="font-semibold text-fg">{s.label}</span>
                {s.detail && <span className="truncate text-fg-subtle">{s.detail}</span>}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

interface SearchHit extends Transmission {
  channel: { channelType: ChannelType; channelId: string; name: string; beaconId?: string; beaconName?: string; relayId?: string } | null;
}

function ResultCard({ hit, beaconId, onJump }: { hit: SearchHit; beaconId?: string; onJump: () => void }) {
  const resolvers = useMarkdownResolvers(beaconId);
  return (
    <article
      aria-label={`Result from ${hit.author.displayName || hit.author.username}`}
      className="group relative rounded-md border border-line bg-raised p-3 hover:border-line-strong"
    >
      <button
        type="button"
        onClick={onJump}
        className="absolute right-2 top-2 rounded-sm bg-overlay px-2 py-0.5 text-xs font-semibold text-fg opacity-0 shadow-pop hover:bg-hover focus:opacity-100 group-hover:opacity-100"
      >
        Jump
      </button>
      <div className="flex gap-3">
        <Avatar user={hit.author} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <UserName user={hit.author} beaconId={beaconId} className="font-medium" />
            <time className="text-xs text-fg-subtle" dateTime={hit.createdAt}>
              {formatMessageTime(hit.createdAt)}
            </time>
          </div>
          <div className="break-words text-[15px] text-fg">
            <Markdown content={hit.content} resolvers={resolvers} />
          </div>
          <Attachments items={hit.attachments} />
        </div>
      </div>
    </article>
  );
}

/** Right-hand results panel, shown in place of the member list while a search is open. */
export function SearchResults({ search }: { search: SearchState }) {
  const navigate = useNavigate();
  const [state, setState] = useState<{ loading: boolean; hits: SearchHit[]; total: number; errors: string[]; failed?: string }>({
    loading: true,
    hits: [],
    total: 0,
    errors: [],
  });
  const beaconId = search.scope === 'dms' ? undefined : search.scope;

  useEffect(() => {
    const s = useStore.getState();
    const users = scopeUsers(s, search.scope);
    const relays = scopeRelays(s, search.scope);
    const { params, errors } = toSearchParams(
      parseSearch(search.query),
      (name) => matchUser(users, name)?.id ?? null,
      (name) => relays.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id ?? null
    );
    if (errors.length) {
      setState({ loading: false, hits: [], total: 0, errors });
      return;
    }
    if (beaconId) params.set('beaconId', beaconId);
    else params.set('scope', 'dms');
    params.set('sort', search.sort);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(search.page * PAGE_SIZE));
    let cancelled = false;
    setState((st) => ({ ...st, loading: true, errors: [], failed: undefined }));
    http
      .get<{ total: number; transmissions: any[] }>(`/search/transmissions?${params}`)
      .then((r) => {
        if (cancelled) return;
        const hits = r.transmissions.map((t) => ({ ...toTransmission(t), channel: t.channel })) as SearchHit[];
        setState({ loading: false, hits, total: r.total, errors: [] });
      })
      .catch((err) => !cancelled && setState({ loading: false, hits: [], total: 0, errors: [], failed: err instanceof ApiError ? err.message : 'Search failed' }));
    return () => {
      cancelled = true;
    };
  }, [search.query, search.scope, search.sort, search.page, beaconId]);

  const set = (patch: Partial<SearchState>) => useUi.setState((u) => (u.search ? { search: { ...u.search, ...patch } } : {}));

  const jump = (hit: SearchHit) => {
    const c = hit.channel;
    if (!c) return;
    const key = channelKey(c.channelType, c.channelId);
    if (c.channelType === 'relay') navigate(`/channels/${c.beaconId}/${c.channelId}`);
    else if (c.channelType === 'thread') navigate(`/channels/${c.beaconId}/${c.relayId}/threads/${c.channelId}`);
    else navigate(`/channels/@me/${c.channelId}`);
    useUi.setState({ jumpTarget: { key, messageId: hit.id } });
  };

  const pages = Math.ceil(state.total / PAGE_SIZE);
  // Consecutive hits in the same channel share a heading.
  const groups: Array<{ label: string; channel: SearchHit['channel']; hits: SearchHit[] }> = [];
  for (const h of state.hits) {
    const last = groups.at(-1);
    if (last && last.channel?.channelId === h.channel?.channelId) last.hits.push(h);
    else groups.push({ label: h.channel?.name ?? 'Unknown', channel: h.channel, hits: [h] });
  }

  return (
    <aside aria-label="Search results" className="flex w-[420px] shrink-0 flex-col bg-raised">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="font-semibold text-fg" aria-live="polite">
          {state.loading ? 'Searching…' : `${state.total.toLocaleString()} Result${state.total === 1 ? '' : 's'}`}
        </h2>
        <div className="flex items-center gap-1" role="tablist" aria-label="Sort results">
          {(['newest', 'oldest'] as const).map((sort) => (
            <button
              key={sort}
              type="button"
              role="tab"
              aria-selected={search.sort === sort}
              onClick={() => set({ sort, page: 0 })}
              className={clsx('rounded-md px-2 py-1 text-sm capitalize', search.sort === sort ? 'bg-active text-fg' : 'text-fg-muted hover:text-fg')}
            >
              {sort}
            </button>
          ))}
          <button type="button" aria-label="Close search" onClick={() => useUi.setState({ search: null })} className="ml-1 text-fg-muted hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={state.loading}>
        {state.loading &&
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="mb-3 flex gap-3 rounded-md bg-raised p-3">
              <div className="h-10 w-10 animate-pulse rounded-full bg-hover" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 animate-pulse rounded bg-hover" />
                <div className="h-3 animate-pulse rounded bg-hover" style={{ width: `${50 + i * 9}%` }} />
              </div>
            </div>
          ))}
        {!state.loading && (state.errors.length > 0 || state.failed || state.hits.length === 0) && (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <SearchX className="mb-4 h-16 w-16 text-fg-subtle" />
            <p className="font-semibold text-fg">{state.errors.length || state.failed ? 'We could not run that search' : 'No results found'}</p>
            {[...state.errors, ...(state.failed ? [state.failed] : [])].map((e) => (
              <p key={e} className="mt-1 text-sm text-danger">
                {e}
              </p>
            ))}
            {!state.errors.length && !state.failed && <p className="mt-1 text-sm text-fg-muted">Try a different word or fewer filters.</p>}
          </div>
        )}
        {!state.loading &&
          groups.map((g, i) => (
            <section key={`${g.channel?.channelId}-${i}`} className="mb-4">
              <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-fg">
                {g.channel?.channelType === 'link' ? <AtSign className="h-4 w-4 text-fg-subtle" /> : <Hash className="h-4 w-4 text-fg-subtle" />}
                {g.label}
              </h3>
              <div className="space-y-2">
                {g.hits.map((h) => (
                  <ResultCard key={h.id} hit={h} beaconId={beaconId} onJump={() => jump(h)} />
                ))}
              </div>
            </section>
          ))}
      </div>

      {!state.loading && pages > 1 && (
        <nav aria-label="Result pages" className="flex h-12 shrink-0 items-center justify-center gap-3 border-t border-line text-sm">
          <button type="button" aria-label="Previous page" disabled={search.page === 0} onClick={() => set({ page: search.page - 1 })} className="text-fg-muted enabled:hover:text-fg disabled:opacity-40">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-fg-muted">
            Page {search.page + 1} of {pages}
          </span>
          <button type="button" aria-label="Next page" disabled={search.page + 1 >= pages} onClick={() => set({ page: search.page + 1 })} className="text-fg-muted enabled:hover:text-fg disabled:opacity-40">
            <ChevronRight className="h-5 w-5" />
          </button>
        </nav>
      )}
    </aside>
  );
}
