import { useEffect, useMemo, useState } from 'react';
import { Hash, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Input, Modal } from '@subspace/ui';
import { useStore } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { isEncryptedChannel } from '../../data/e2ee';
import { http } from '../../lib/http';
import { channelKey, parseChannelKey, type ChannelKey } from '../../lib/types';
import { closeModal, toast } from '../../app/ui';
import { term } from '../../lib/strings';
import { Avatar } from '../common/Avatar';

type Target = { key: ChannelKey; label: string; sub: string; icon: React.ReactNode };

/** Discord's Forward: pick up to five places, add a comment, send a copy of the transmission there. */
export function ForwardModal({ channelKey: source, messageId }: { channelKey: ChannelKey; messageId: string }) {
  const s = useStore();
  const message = s.messages[source]?.byId[messageId];
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Array<{ id: string; name: string; beaconName?: string; type: string }>>([]);
  const [chosen, setChosen] = useState<ChannelKey[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();

  // Relays in beacons not opened yet come from the same search Quick Scan uses.
  useEffect(() => {
    if (q.length < 2) return setRemote([]);
    const t = setTimeout(() => {
      http
        .get<{ relays?: Array<{ id: string; name: string; beaconName?: string; type: string }> }>(`/search/quick-scan?q=${encodeURIComponent(q)}`)
        .then((r) => setRemote(r.relays ?? []))
        .catch(() => setRemote([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    for (const l of Object.values(s.links)) {
      const key = channelKey('link', l.id);
      if (isEncryptedChannel(key)) continue;
      out.push({ key, label: l.recipient.displayName || l.recipient.username, sub: term('link'), icon: <Avatar user={l.recipient} size={24} /> });
    }
    for (const m of Object.values(s.meshes)) out.push({ key: channelKey('mesh', m.id), label: m.name, sub: term('mesh'), icon: <Users className="h-5 w-5" /> });
    const seen = new Set<string>();
    for (const r of Object.values(s.relays)) {
      if (r.type !== 'text' || !can(relayPermissions(s, r.id), PERMISSIONS.SEND_TRANSMISSIONS)) continue;
      seen.add(r.id);
      out.push({ key: channelKey('relay', r.id), label: r.name, sub: s.beacons[r.beaconId]?.name ?? '', icon: <Hash className="h-5 w-5" /> });
    }
    for (const r of remote) if (r.type === 'text' && !seen.has(r.id)) out.push({ key: channelKey('relay', r.id), label: r.name, sub: r.beaconName ?? '', icon: <Hash className="h-5 w-5" /> });
    return out.filter((t) => !q || t.label.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q)).slice(0, 50);
  }, [s, remote, q]);

  const send = async () => {
    setBusy(true);
    try {
      await http.post(`/transmissions/${messageId}/forward`, {
        targets: chosen.map((k) => {
          const { type, id } = parseChannelKey(k);
          return { channelType: type, channelId: id };
        }),
        comment: comment.trim() || undefined,
      });
      toast(chosen.length === 1 ? 'Forwarded' : `Forwarded to ${chosen.length} places`, 'success');
      closeModal();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={closeModal}
      title="Forward To"
      description="Select where you want to share this transmission."
      maxWidth="lg"
      footer={
        <Button onClick={() => void send()} isLoading={busy} disabled={!chosen.length}>
          Send{chosen.length > 1 ? ` (${chosen.length})` : ''}
        </Button>
      }
    >
      <Input aria-label="Search destinations" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul aria-label="Destinations" className="mt-3 max-h-72 overflow-y-auto">
        {targets.map((t) => {
          const on = chosen.includes(t.key);
          return (
            <li key={t.key}>
              <label className={clsx('flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-hover', on && 'bg-active')}>
                <span className="flex h-8 w-8 items-center justify-center text-fg-muted">{t.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{t.label}</span>
                  <span className="block truncate text-xs text-fg-subtle">{t.sub}</span>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Forward to ${t.label}`}
                  checked={on}
                  disabled={!on && chosen.length >= 5}
                  onChange={() => setChosen(on ? chosen.filter((k) => k !== t.key) : [...chosen, t.key])}
                  className="h-4 w-4 accent-[var(--color-brand)]"
                />
              </label>
            </li>
          );
        })}
        {!targets.length && <li className="py-6 text-center text-sm text-fg-subtle">Nothing matches “{query}”.</li>}
      </ul>
      {message && (
        <div className="mt-3 rounded-md border-l-4 border-line-strong bg-raised px-3 py-2 text-sm text-fg-muted">
          <p className="line-clamp-3 whitespace-pre-wrap break-words">{message.content || (message.attachments.length ? `${message.attachments.length} attachment(s)` : 'Sticker')}</p>
        </div>
      )}
      <Input aria-label="Add an optional comment" placeholder="Add an optional comment" className="mt-3" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
    </Modal>
  );
}
