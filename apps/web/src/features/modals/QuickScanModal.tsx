import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Modal } from '@subspace/ui';
import { useStore } from '../../data/store';
import { openDirectLink } from '../../data/actions';
import { http } from '../../lib/http';
import { toUserRef, userTag } from '../../lib/normalize';
import type { UserRef } from '../../lib/types';
import { closeModal, toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { RelayIcon } from '../sidebar/BeaconSidebar';
import { term } from '../../lib/strings';

type Result =
  | { kind: 'user'; id: string; user: UserRef; sub: string }
  | { kind: 'mesh'; id: string; name: string }
  | { kind: 'relay'; id: string; name: string; beaconId: string; beaconName: string; type: string }
  | { kind: 'beacon'; id: string; name: string; iconUrl: string | null };

/** Subspace Quick Scan: Discord's Ctrl+K switcher. Prefix @ users, # relays, * beacons. */
export function QuickScanModal() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<UserRef[]>([]);
  const s = useStore();

  const mode = query.startsWith('@') ? 'user' : query.startsWith('#') ? 'relay' : query.startsWith('*') ? 'beacon' : 'all';
  const q = (mode === 'all' ? query : query.slice(1)).trim().toLowerCase();

  useEffect(() => {
    if (q.length < 2 || (mode !== 'all' && mode !== 'user')) {
      setRemote([]);
      return;
    }
    const t = setTimeout(() => {
      http
        .get<{ transmitters?: any[] }>(`/search/quick-scan?q=${encodeURIComponent(q)}`)
        .then((r) => setRemote((r.transmitters ?? []).map((u) => toUserRef(u))))
        .catch(() => setRemote([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q, mode]);

  const results = useMemo<Result[]>(() => {
    const match = (...fields: Array<string | null | undefined>) => !q || fields.some((f) => f?.toLowerCase().includes(q));
    const out: Result[] = [];
    if (mode === 'all' || mode === 'user') {
      const seen = new Set<string>();
      const addUser = (u: UserRef, sub: string) => {
        if (seen.has(u.id) || u.id === s.me?.id || !match(u.username, u.displayName)) return;
        seen.add(u.id);
        out.push({ kind: 'user', id: u.id, user: u, sub });
      };
      Object.values(s.links).forEach((l) => addUser(l.recipient, userTag(l.recipient)));
      Object.values(s.relationships).filter((r) => r.type === 'friend').forEach((r) => addUser(r.user, userTag(r.user)));
      remote.forEach((u) => addUser(u, userTag(u)));
      if (mode === 'all') Object.values(s.meshes).filter((m) => match(m.name)).forEach((m) => out.push({ kind: 'mesh', id: m.id, name: m.name }));
    }
    if (mode === 'all' || mode === 'relay') {
      for (const r of Object.values(s.relays)) {
        if (r.type === 'category' || r.isHidden || !match(r.name)) continue;
        out.push({ kind: 'relay', id: r.id, name: r.name, beaconId: r.beaconId, beaconName: s.beacons[r.beaconId]?.name ?? '', type: r.type });
      }
    }
    if (mode === 'all' || mode === 'beacon') {
      for (const b of Object.values(s.beacons)) if (match(b.name)) out.push({ kind: 'beacon', id: b.id, name: b.name, iconUrl: b.iconUrl });
    }
    // Unread relays first when no query (Discord surfaces recent/unread).
    return out.slice(0, 40);
  }, [s, q, mode, remote]);

  useEffect(() => setActive(0), [query]);

  const go = async (r: Result) => {
    closeModal();
    if (r.kind === 'relay') navigate(`/channels/${r.beaconId}/${r.id}`);
    else if (r.kind === 'beacon') navigate(`/channels/${r.id}`);
    else if (r.kind === 'mesh') navigate(`/channels/@me/${r.id}`);
    else {
      try {
        navigate(`/channels/@me/${await openDirectLink(r.id)}`);
      } catch {
        toast('You cannot open a Direct Link with this transmitter.', 'error');
      }
    }
  };

  return (
    <Modal isOpen onClose={closeModal} maxWidth="xl" hideCloseButton>
      <p className="mb-3 text-center text-lg font-semibold text-fg">Search for {term('beacon', true).toLowerCase()}, {term('relay', true).toLowerCase()} or links</p>
      <input
        autoFocus
        data-autofocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, Math.min(results.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter' && results[active]) void go(results[active]);
        }}
        placeholder="Where would you like to go?"
        aria-label="Quick Scan"
        className="h-14 w-full rounded-md bg-void px-4 text-lg text-fg outline-none placeholder:text-fg-subtle"
      />
      <div role="listbox" className="mt-3 max-h-[50vh] overflow-y-auto">
        {results.length === 0 && <p className="py-8 text-center text-sm text-fg-subtle">No matches. Try a different search.</p>}
        {results.map((r, i) => (
          <button
            key={`${r.kind}:${r.id}`}
            role="option"
            aria-selected={i === active}
            type="button"
            onMouseEnter={() => setActive(i)}
            onClick={() => void go(r)}
            className={clsx('flex h-10 w-full items-center gap-3 rounded-md px-2 text-left', i === active ? 'bg-active' : '')}
          >
            {r.kind === 'user' && (
              <>
                <Avatar user={r.user} size={24} showPresence ring="var(--color-overlay)" />
                <span className="font-medium text-fg">{r.user.displayName || r.user.username}</span>
                <span className="text-sm text-fg-subtle">{r.sub}</span>
              </>
            )}
            {r.kind === 'mesh' && <span className="font-medium text-fg">{r.name}</span>}
            {r.kind === 'relay' && (
              <>
                <RelayIcon type={r.type as any} className="h-5 w-5 text-fg-subtle" />
                <span className="font-medium text-fg">{r.name}</span>
                <span className="ml-auto text-xs font-semibold uppercase text-fg-subtle">{r.beaconName}</span>
              </>
            )}
            {r.kind === 'beacon' && (
              <>
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-raised text-[10px] font-bold">
                  {r.iconUrl ? <img src={r.iconUrl} alt="" className="h-full w-full object-cover" /> : r.name[0]}
                </span>
                <span className="font-medium text-fg">{r.name}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        <span className="font-bold text-brand-sky">PROTIP:</span> Start searches with @ # * to narrow down results.
      </p>
    </Modal>
  );
}
