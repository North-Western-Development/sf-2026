import { useEffect, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { useStore, setState } from '../../data/store';
import { http, ApiError } from '../../lib/http';
import { ensureDevice, safetyNumbers } from '../../lib/e2ee/client';
import type { DirectLink } from '../../lib/types';
import { confirmAction, toast } from '../../app/ui';
import { HeaderButton } from './ChannelView';

/** Turn on end-to-end encryption for a direct link, or (once on) verify safety numbers. */
export function EncryptionButton({ link }: { link: DirectLink }) {
  const [verifying, setVerifying] = useState(false);
  const meId = useStore((s) => s.me?.id);
  const name = link.recipient.displayName || link.recipient.username;

  if (link.encryptedAt) {
    return (
      <>
        <HeaderButton label="End-to-End Encrypted" active onClick={() => setVerifying(true)}>
          <Lock className="h-5 w-5 text-online" />
        </HeaderButton>
        {verifying && meId && <SafetyNumbers myId={meId} other={{ id: link.recipient.id, name }} onClose={() => setVerifying(false)} />}
      </>
    );
  }

  const turnOn = () =>
    confirmAction({
      title: 'Turn on end-to-end encryption?',
      body: `Transmissions you and @${name} send from now on are encrypted on your devices, so not even Subspace can read them. This cannot be turned off. Search and link previews will not work here, and a device added later cannot read earlier transmissions.`,
      confirmLabel: 'Turn On',
      onConfirm: async () => {
        if (!meId || !(await ensureDevice(meId))) return toast('This browser cannot store encryption keys.', 'error');
        try {
          const { encryptedAt } = await http.post<{ encryptedAt: string }>(`/e2ee/links/${link.id}/enable`);
          setState((s) => ({ links: { ...s.links, [link.id]: { ...s.links[link.id], encryptedAt } } }));
        } catch (err) {
          toast(err instanceof ApiError ? err.message : 'Could not turn on encryption', 'error');
        }
      },
    });

  return (
    <HeaderButton label="Turn On Encryption" onClick={turnOn}>
      <LockOpen className="h-5 w-5" />
    </HeaderButton>
  );
}

function SafetyNumbers({ myId, other, onClose }: { myId: string; other: { id: string; name: string }; onClose: () => void }) {
  const [numbers, setNumbers] = useState<Awaited<ReturnType<typeof safetyNumbers>> | null>(null);
  useEffect(() => {
    void safetyNumbers(myId, other.id).then(setNumbers, () => setNumbers({ mine: null, theirs: [] }));
  }, [myId, other.id]);

  return (
    <Modal isOpen onClose={onClose} title="Verify Encryption" description={`Compare these numbers with @${other.name} in person or on a call. If they match, nobody is in the middle.`} maxWidth="md">
      {!numbers ? (
        <p className="py-8 text-center text-sm text-fg-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">This device</h3>
            <p className="rounded-lg bg-raised p-3 font-mono text-sm tracking-wide text-fg" aria-label="Your safety number">
              {numbers.mine ?? 'Not set up'}
            </p>
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">@{other.name}’s devices</h3>
            <ul aria-label={`${other.name}'s safety numbers`} className="space-y-2">
              {numbers.theirs.map((d, i) => (
                <li key={i} className="rounded-lg bg-raised p-3">
                  <p className="text-xs text-fg-muted">{d.name}</p>
                  <p className="font-mono text-sm tracking-wide text-fg">{d.number}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
