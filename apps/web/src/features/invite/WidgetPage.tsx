import { useEffect, useState } from 'react';
import { PixelStar } from '../auth/PixelStar';

interface Widget {
  id: string;
  name: string;
  iconUrl: string | null;
  instantInvite: string | null;
  presenceCount: number;
  members: Array<{ username: string; avatarUrl: string | null; status: string }>;
}

const DOT: Record<string, string> = { online: 'bg-online', idle: 'bg-star', dnd: 'bg-danger' };

/** The embeddable beacon widget (Discord's): who is online, and a Join button. Works signed out. */
export function WidgetPage({ beaconId }: { beaconId: string }) {
  const [w, setW] = useState<Widget | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`/api/v1/beacons/${beaconId}/widget.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setW)
      .catch(() => setError(true));
  }, [beaconId]);

  return (
    <div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-lg bg-raised text-fg">
      <header className="flex items-center gap-3 bg-brand px-4 py-3 text-on-brand">
        <PixelStar size={24} />
        <span className="min-w-0 flex-1 truncate font-semibold">{w?.name ?? 'Subspace'}</span>
        {w && <span className="text-sm font-medium">{w.presenceCount} Online</span>}
      </header>
      <ul aria-label="Online members" className="flex-1 space-y-1 overflow-y-auto p-3">
        {error && <li className="text-sm text-fg-muted">This widget is turned off.</li>}
        {w?.members.map((m, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="relative">
              {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-overlay text-xs">{m.username[0]?.toUpperCase()}</span>}
              <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-raised ${DOT[m.status] ?? 'bg-online'}`} />
            </span>
            <span className="truncate">{m.username}</span>
          </li>
        ))}
      </ul>
      {w?.instantInvite && (
        <footer className="border-t border-line p-3">
          <a href={`/invite/${w.instantInvite}`} target="_blank" rel="noreferrer noopener" className="block rounded-md bg-online py-2 text-center text-sm font-semibold text-void hover:brightness-110">
            Join {w.name}
          </a>
        </footer>
      )}
    </div>
  );
}
