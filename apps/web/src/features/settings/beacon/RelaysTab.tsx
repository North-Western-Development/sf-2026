import { useMemo, useState } from 'react';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { Button } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../data/store';
import { closeModal, openModal } from '../../../app/ui';
import { relayKindLabel, term } from '../../../lib/strings';
import type { Relay } from '../../../lib/types';
import { RelayIcon } from '../../sidebar/BeaconSidebar';
import { SettingsTitle } from '../SettingsLayout';

/**
 * Every relay in one searchable list, grouped by band like the sidebar. Replaces a nav entry
 * per relay, which stops working once a beacon has more than a handful.
 */
export function RelaysTab({ beaconId, onOpen }: { beaconId: string; onOpen: (relayId: string) => void }) {
  const all = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r): r is Relay => !!r)));
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const byPos = (a: Relay, b: Relay) => a.position - b.position;
    const bands = all.filter((r) => r.type === 'category').sort(byPos);
    const relays = all.filter((r) => r.type !== 'category' && (!q || r.name.toLowerCase().includes(q) || (r.topic ?? '').toLowerCase().includes(q)));
    const out: Array<{ id: string; name: string | null; relays: Relay[] }> = [{ id: 'none', name: null, relays: relays.filter((r) => !r.parentId).sort(byPos) }];
    for (const b of bands) out.push({ id: b.id, name: b.name, relays: relays.filter((r) => r.parentId === b.id).sort(byPos) });
    return out.filter((g) => g.relays.length);
  }, [all, q]);
  const count = all.filter((r) => r.type !== 'category').length;

  return (
    <>
      <SettingsTitle>{term('relay', true)}</SettingsTitle>
      <p className="-mt-3 mb-5 text-sm text-fg-muted">
        {count} {count === 1 ? term('relay').toLowerCase() : term('relay', true).toLowerCase()}. Pick one to edit its name, topic and permissions.
      </p>
      <div className="mb-4 flex gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-md bg-void px-2.5 ring-1 ring-line focus-within:ring-brand-sky">
          <Search className="h-4 w-4 text-fg-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${term('relay', true).toLowerCase()}`} aria-label={`Search ${term('relay', true).toLowerCase()}`} className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
        </label>
        <Button
          size="sm"
          onClick={() => {
            closeModal();
            openModal({ kind: 'createRelay', beaconId });
          }}
        >
          <Plus className="h-4 w-4" /> Create
        </Button>
      </div>
      {groups.length === 0 && <p className="py-8 text-center text-sm text-fg-subtle">No {term('relay', true).toLowerCase()} match “{query}”.</p>}
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.name ?? `No ${term('band').toLowerCase()}`}>
            {g.name && <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{g.name}</h3>}
            <ul className="divide-y divide-line overflow-hidden rounded-lg bg-raised ring-1 ring-line">
              {g.relays.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover">
                    <RelayIcon type={r.type} className="h-5 w-5 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-fg">{r.name}</span>
                      <span className="block truncate text-xs text-fg-subtle">{r.topic || relayKindLabel(r.type)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
