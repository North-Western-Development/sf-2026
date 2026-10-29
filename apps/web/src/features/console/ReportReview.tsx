import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { BadgeCheck, CircleHelp, EyeOff, Hash, Paperclip } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { openFile } from '../../lib/e2ee/client';
import { toast } from '../../app/ui';
import { RowButton } from '../settings/SettingsLayout';

/** One transmission of an encrypted report's context, as the API recorded it (reports.routes.ts). */
export interface ContextItem {
  id: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
  edited: boolean;
  target: boolean;
  status: 'verified' | 'unverified' | 'not-shared';
  text?: string;
  plain?: boolean;
  attachments?: Array<{ url: string; key: string; filename: string; mimeType: string; size: number }>;
}

const STATUS = {
  verified: { icon: BadgeCheck, label: 'Verified', tone: 'text-online', help: 'Matches what the sender sent.' },
  unverified: { icon: CircleHelp, label: 'Not verifiable', tone: 'text-warning', help: 'Sent before reports could be verified: the reporter could have changed it.' },
  'not-shared': { icon: EyeOff, label: 'Not shared', tone: 'text-fg-subtle', help: "The reporter's device could not open it." },
} as const;

/** Open an encrypted attachment the reporter shared: it is decrypted here, in this browser. */
async function openShared(a: { url: string; key: string; mimeType: string }) {
  // The sender chose the address: only this instance's own storage, never another site.
  if (new URL(a.url, window.location.origin).origin !== window.location.origin) {
    toast('That attachment is not stored on this instance.', 'error');
    return;
  }
  try {
    window.open(await openFile(a.url, a.key, a.mimeType), '_blank', 'noopener');
  } catch (err) {
    toast((err as Error).message || 'The attachment could not be opened.', 'error');
  }
}

/** The reported encrypted transmission and those around it, with whether each was verified. */
export function EncryptedContext({ items }: { items: ContextItem[] }) {
  return (
    <ol aria-label="Shared conversation" className="mt-3 space-y-1 rounded-md bg-void p-2">
      {items.map((i) => {
        const s = i.plain ? null : STATUS[i.status];
        return (
          <li key={i.id} aria-label={`${i.authorName ?? 'Unknown'}: ${s ? s.label : 'Sent before encryption'}`} className={clsx('rounded px-2 py-1.5', i.target && 'bg-danger-soft ring-1 ring-danger/50')}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-fg">{i.authorName ?? i.authorId}</span>
              <span className="text-fg-subtle">{new Date(i.createdAt).toLocaleString()}</span>
              {i.edited && <span className="text-fg-subtle">(edited)</span>}
              {i.target && <span className="font-bold uppercase text-danger">Reported</span>}
              {s && (
                <span className={clsx('ml-auto inline-flex items-center gap-1', s.tone)} title={s.help}>
                  <s.icon className="h-3.5 w-3.5" aria-hidden /> {s.label}
                </span>
              )}
            </div>
            {i.text !== undefined ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{i.text || <span className="italic text-fg-subtle">(no text)</span>}</p> : <p className="mt-0.5 text-sm italic text-fg-subtle">Not shared</p>}
            {i.attachments?.map((a) => (
              <button key={a.url} type="button" onClick={() => void openShared(a)} className="mt-1 inline-flex items-center gap-1 text-xs text-brand-sky hover:underline">
                <Paperclip className="h-3.5 w-3.5" aria-hidden /> Open {a.filename}
              </button>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

interface ReaderRelay {
  id: string;
  name: string;
  type: string;
}

interface ReaderTransmission {
  id: string;
  content: string;
  createdAt: string;
  author?: { displayName?: string | null; username?: string } | null;
  attachments?: Array<{ url: string; filename: string }>;
}

/**
 * Read-only view of the beacon a report concerns. Staff do not join it: the server keeps no
 * membership, presence or read state for them, so members cannot tell. Each relay opened is
 * written to the staff log.
 */
export function BeaconReader({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const [beacon, setBeacon] = useState<{ name: string; relays: ReaderRelay[]; focus: { relayId: string; transmissionId: string } | null } | null>(null);
  const [relayId, setRelayId] = useState<string | null>(null);
  const [items, setItems] = useState<ReaderTransmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    http
      .get<{ beacon: { name: string }; relays: ReaderRelay[]; focus: { relayId: string; transmissionId: string } | null }>(`/console/reports/${reportId}/beacon`)
      .then((r) => {
        setBeacon({ name: r.beacon.name, relays: r.relays, focus: r.focus });
        setRelayId(r.focus?.relayId ?? r.relays.find((x) => x.type !== 'comm_link')?.id ?? null);
      })
      .catch((err) => setError((err as Error).message));
  }, [reportId]);

  useEffect(() => {
    if (!relayId || !beacon) return;
    setItems(null);
    const around = beacon.focus?.relayId === relayId ? `?around=${beacon.focus.transmissionId}` : '';
    http
      .get<{ transmissions: ReaderTransmission[] }>(`/console/reports/${reportId}/beacon/relays/${relayId}/transmissions${around}`)
      .then((r) => setItems(r.transmissions))
      .catch((err) => setError((err as Error).message));
  }, [relayId, beacon, reportId]);

  const older = async () => {
    if (!items?.length || !relayId) return;
    const r = await http.get<{ transmissions: ReaderTransmission[] }>(`/console/reports/${reportId}/beacon/relays/${relayId}/transmissions?before=${items[0].id}`);
    setItems([...r.transmissions, ...items]);
  };

  return (
    <Modal isOpen onClose={onClose} title={beacon ? `Reading ${beacon.name}` : 'Reading beacon'} maxWidth="xl">
      <p role="note" className="mb-3 rounded-md bg-raised px-3 py-2 text-sm text-fg-muted">
        Read-only. You have not joined, so members cannot see you here. Each relay you open is recorded in the staff log.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {beacon && (
        <div className="flex h-[60vh] min-h-0 gap-3">
          <nav aria-label="Relays" className="w-48 shrink-0 overflow-y-auto">
            {beacon.relays.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-current={r.id === relayId}
                onClick={() => setRelayId(r.id)}
                className={clsx('flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm', r.id === relayId ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover')}
              >
                <Hash className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate">{r.name}</span>
              </button>
            ))}
          </nav>
          <section aria-label="Transmissions" className="min-w-0 flex-1 overflow-y-auto rounded-md bg-void p-2">
            {items === null ? (
              <p className="text-sm text-fg-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-fg-muted">No transmissions here.</p>
            ) : (
              <>
                <RowButton onClick={() => void older()}>Load older</RowButton>
                <ol className="mt-2 space-y-1">
                  {items.map((t) => (
                    <li key={t.id} className={clsx('rounded px-2 py-1', beacon.focus?.transmissionId === t.id && 'bg-danger-soft ring-1 ring-danger/50')}>
                      <div className="flex gap-2 text-xs">
                        <span className="font-semibold text-fg">{t.author?.displayName || t.author?.username || 'Unknown'}</span>
                        <span className="text-fg-subtle">{new Date(t.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-fg">{t.content}</p>
                      {t.attachments?.map((a) => (
                        <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-sky hover:underline">
                          <Paperclip className="h-3.5 w-3.5" aria-hidden /> {a.filename}
                        </a>
                      ))}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
