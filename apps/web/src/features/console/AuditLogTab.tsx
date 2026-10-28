import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Button } from '@subspace/ui';
import { http } from '../../lib/http';
import { toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { SettingsSection } from '../settings/SettingsLayout';

interface Entry {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  actor: { id: string; username: string; discriminator: string; displayName: string; avatarUrl: string | null } | null;
}

/** Every action staff take in the console, newest first. */
export function AuditLogTab() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const fetchPage = async (before?: string) => {
    setBusy(true);
    try {
      const r = await http.get<{ entries: Entry[]; hasMore: boolean }>(`/console/audit-log${before ? `?before=${before}` : ''}`);
      setEntries((prev) => (before ? [...(prev ?? []), ...r.entries] : r.entries));
      setHasMore(r.hasMore);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void fetchPage();
  }, []);
  return (
    <SettingsSection title="Staff Log" description="Every action staff take in the Command Console, newest first.">
      {entries === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center">
          <ScrollText className="mx-auto h-10 w-10 text-fg-subtle" />
          <p className="mt-3 font-semibold text-fg">Nothing yet</p>
          <p className="mt-1 text-sm text-fg-muted">Staff actions will show up here.</p>
        </div>
      ) : (
        <>
          <ol aria-label="Staff log" className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                {e.actor ? <Avatar user={e.actor} size={28} decoration={false} /> : <span className="h-7 w-7 shrink-0 rounded-full bg-active" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">
                    <span className="font-semibold">{e.actor ? e.actor.displayName || e.actor.username : 'A deleted account'}</span> <span className="text-fg-muted">·</span> {e.summary}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                    <span className="ml-2 font-mono">{e.action}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {hasMore && (
            <Button size="sm" variant="secondary" className="mt-3" isLoading={busy} onClick={() => void fetchPage(entries[entries.length - 1]?.id)}>
              Show older
            </Button>
          )}
        </>
      )}
    </SettingsSection>
  );
}
