import { useEffect, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { useStore, setState } from '../../data/store';
import { http, ApiError } from '../../lib/http';
import { ensureDevice, safetyNumbers } from '../../lib/e2ee/client';
import type { DirectLink, Mesh } from '../../lib/types';
import { Avatar } from '../common/Avatar';
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

/** The same for a group DM: every member needs a device; verify any member's safety numbers. */
export function MeshEncryptionButton({ mesh }: { mesh: Mesh }) {
  const [picking, setPicking] = useState(false);
  const [verifying, setVerifying] = useState<{ id: string; name: string } | null>(null);
  const meId = useStore((s) => s.me?.id);
  const others = mesh.members.filter((m) => m.id !== meId);

  if (mesh.encryptedAt) {
    return (
      <>
        <HeaderButton label="End-to-End Encrypted" active onClick={() => setPicking(true)}>
          <Lock className="h-5 w-5 text-online" />
        </HeaderButton>
        {picking && (
          <Modal isOpen onClose={() => setPicking(false)} title="Verify Encryption" description="Pick someone to compare safety numbers with." maxWidth="sm">
            <ul aria-label="Members to verify" className="space-y-1">
              {others.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicking(false);
                      setVerifying({ id: m.id, name: m.displayName || m.username });
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
                  >
                    <Avatar user={m} size={32} />
                    <span className="text-sm font-medium text-fg">{m.displayName || m.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Modal>
        )}
        {verifying && meId && <SafetyNumbers myId={meId} other={verifying} onClose={() => setVerifying(null)} />}
      </>
    );
  }

  const turnOn = () =>
    confirmAction({
      title: 'Turn on end-to-end encryption?',
      body: 'Transmissions and calls in this group from now on are encrypted on your devices, so not even Subspace can read them. This cannot be turned off. Everyone here needs a device that supports encryption, people added later read only from when they join, and someone who leaves cannot read what follows.',
      confirmLabel: 'Turn On',
      onConfirm: async () => {
        if (!meId || !(await ensureDevice(meId))) return toast('This browser cannot store encryption keys.', 'error');
        try {
          const { encryptedAt } = await http.post<{ encryptedAt: string }>(`/e2ee/meshes/${mesh.id}/enable`);
          setState((s) => ({ meshes: { ...s.meshes, [mesh.id]: { ...s.meshes[mesh.id], encryptedAt } } }));
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
