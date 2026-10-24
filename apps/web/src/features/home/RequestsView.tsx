import { useState } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Inbox } from 'lucide-react';
import { Button, ComingSoon } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { blockUser, respondTransmissionRequest } from '../../data/actions';
import { userTag } from '../../lib/normalize';
import { term } from '../../lib/strings';
import { formatMessageTime } from '../../lib/time';
import { confirmAction, openModal, toast } from '../../app/ui';
import { Avatar } from '../common/Avatar';
import { Markdown } from '../chat/markdown';
import { PixelStar } from '../auth/PixelStar';
import { MobileNavButton } from '../../app/mobile';

/** Discord's Message Requests page: introductory transmissions from non-affiliates. */
export function RequestsView() {
  const navigate = useNavigate();
  const requests = useStore(useShallow((s) => Object.values(s.transmissionRequests).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))));
  const beacons = useStore((s) => s.beacons);
  const [tab, setTab] = useState<'requests' | 'spam'>('requests');
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      const linkId = await respondTransmissionRequest(id, accept);
      if (accept && linkId) navigate(`/channels/@me/${linkId}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-4 shadow-sm">
        <MobileNavButton />
        <span className="flex items-center gap-2 font-semibold text-fg">
          <Inbox className="h-6 w-6 text-fg-subtle" /> {term('transmissionRequest', true)}
        </span>
        <span className="h-6 w-px bg-line-strong" />
        <button
          type="button"
          aria-pressed={tab === 'requests'}
          onClick={() => setTab('requests')}
          className={clsx('rounded-md px-2 py-0.5 text-[15px] font-medium', tab === 'requests' ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover')}
        >
          Requests
        </button>
        <ComingSoon label="Spam filtering" placement="bottom">
          <span className="rounded-md px-2 py-0.5 text-[15px] font-medium text-fg-muted">Spam</span>
        </ComingSoon>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-4">
        <p className="mb-4 text-sm text-fg-muted">
          {term('user', true)} who share a {term('beacon').toLowerCase()} with you can send one introductory transmission. Requests expire after 7 days.
        </p>
        {requests.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center text-fg-muted">
            <PixelStar size={48} />
            <p>No pending {term('transmissionRequest', true).toLowerCase()}. Quiet frequency.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-raised p-4">
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => openModal({ kind: 'profile', userId: r.sender.id })} className="rounded-full">
                    <Avatar user={r.sender} size={40} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="font-semibold text-fg">{r.sender.displayName || r.sender.username}</span>
                      <span className="text-xs text-fg-subtle">{userTag(r.sender)}</span>
                      <span className="text-xs text-fg-subtle">{formatMessageTime(r.createdAt)}</span>
                    </p>
                    {beacons[r.mutualBeaconId] && <p className="text-xs text-fg-subtle">Mutual {term('beacon').toLowerCase()}: {beacons[r.mutualBeaconId].name}</p>}
                    <div className="mt-2 text-[15px] text-fg">
                      <Markdown content={r.content} />
                    </div>
                    <p className="mt-2 text-xs text-fg-subtle">Expires {new Date(r.expiresAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() =>
                      confirmAction({
                        title: `Block ${userTag(r.sender)}`,
                        body: 'Declines this request and blocks the sender.',
                        confirmLabel: 'Block',
                        danger: true,
                        onConfirm: async () => {
                          await respondTransmissionRequest(r.id, false);
                          await blockUser(r.sender.id);
                        },
                      })
                    }
                  >
                    Block
                  </Button>
                  <Button size="sm" variant="secondary" isLoading={busy === r.id} onClick={() => void respond(r.id, false)}>
                    Ignore
                  </Button>
                  <Button size="sm" isLoading={busy === r.id} onClick={() => void respond(r.id, true)}>
                    Accept
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
