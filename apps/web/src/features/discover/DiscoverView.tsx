import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Compass, Search, Users } from 'lucide-react';
import { Button } from '@subspace/ui';
import { http } from '../../lib/http';
import { toBeacon } from '../../lib/normalize';
import { useStore, setState } from '../../data/store';
import type { Beacon } from '../../lib/types';
import { term } from '../../lib/strings';
import { toast } from '../../app/ui';
import { PixelStar } from '../auth/PixelStar';
import { MobileNavButton } from '../../app/mobile';
import { categoryOf } from './categories';

type Listing = Beacon & { memberCount?: number; onlineCount?: number };

function Card({ b }: { b: Listing }) {
  const navigate = useNavigate();
  const joined = useStore((s) => !!s.beacons[b.id]);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (joined) return navigate(`/channels/${b.id}`);
    setBusy(true);
    try {
      await http.post(`/beacons/${b.id}/join`);
      setState((s) => ({ beacons: { ...s.beacons, [b.id]: b }, beaconOrder: [...s.beaconOrder, b.id] }));
      navigate(`/channels/${b.id}`);
    } catch (err) {
      toast((err as Error).message || 'Could not join beacon', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="flex flex-col overflow-hidden rounded-xl bg-raised transition-transform hover:-translate-y-0.5 hover:shadow-pop">
      <div className="relative h-[136px] bg-brand-gradient">
        {b.bannerUrl && <img src={b.bannerUrl} alt="" className="h-full w-full object-cover" />}
        <span className="absolute -bottom-6 left-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-overlay text-lg font-bold ring-4 ring-raised">
          {b.iconUrl ? <img src={b.iconUrl} alt="" className="h-full w-full object-cover" /> : b.name[0]?.toUpperCase()}
        </span>
      </div>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-8">
        <h3 className="truncate font-bold text-fg">{b.name}</h3>
        <p className="mt-1 line-clamp-3 flex-1 text-sm text-fg-muted">{b.description || 'No description yet.'}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-3 text-xs text-fg-subtle">
            {b.onlineCount !== undefined && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-online" /> {b.onlineCount.toLocaleString()} Online
              </span>
            )}
            {b.memberCount !== undefined && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" /> {b.memberCount.toLocaleString()} Members
              </span>
            )}
          </span>
          <Button size="sm" variant={joined ? 'secondary' : 'primary'} onClick={join} isLoading={busy}>
            {joined ? 'Open' : 'Join'}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function DiscoverView() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [query, setQuery] = useState('');
  // The sidebar (DiscoverSidebar) picks a category.
  const category = categoryOf(useSearchParams()[0].get('category'));

  useEffect(() => {
    setListings(null);
    http
      .get<{ beacons: any[] }>(category ? `/beacons/discovery?category=${category.id}` : '/beacons/discovery')
      .then((r) => setListings(r.beacons.map((b) => ({ ...toBeacon(b), memberCount: b.memberCount, onlineCount: b.onlineCount }))))
      .catch(() => setListings([]));
  }, [category]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (listings ?? []).filter((b) => !q || b.name.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q));
  }, [listings, query]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-3 pt-2 md:hidden">
        <MobileNavButton />
      </div>
      <section className="relative mx-3 mt-3 md:mx-6 md:mt-6 overflow-hidden rounded-2xl bg-raised px-8 py-12 text-center">
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgb(59 142 242 / 0.25), transparent 70%)' }} />
        <PixelStar size={36} className="relative mx-auto mb-3" />
        <h1 className="relative text-3xl font-bold text-fg">Find your frequency</h1>
        <p className="relative mt-2 text-fg-muted">From deep-space gaming crews to research outposts, there's a {term('beacon').toLowerCase()} for you.</p>
        <label className="relative mx-auto mt-6 flex h-11 max-w-xl items-center gap-2 rounded-lg bg-void px-4">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Explore ${term('beacon', true).toLowerCase()}`} aria-label="Search beacons" className="flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle" />
          <Search className="h-5 w-5 text-fg-subtle" />
        </label>
      </section>

      <div className="px-6 pb-10 pt-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-fg">
          {category ? <category.icon className="h-5 w-5 text-online" /> : <Compass className="h-5 w-5 text-online" />}{' '}
          {query ? `Results for “${query}”` : category ? category.label : `Featured ${term('beacon', true)}`}
        </h2>
        {listings === null ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[280px] animate-pulse rounded-xl bg-raised" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-fg-muted">No discoverable {term('beacon', true).toLowerCase()} match your search.</p>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {shown.map((b) => (
              <Card key={b.id} b={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
