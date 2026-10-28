import { useEffect, useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, Modal } from '@subspace/ui';
import { useStore } from '../../data/store';
import { loadBeacon } from '../../data/actions';
import { PERMISSIONS } from '../../data/permissions';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { closeModal, toast } from '../../app/ui';

const canManageWebhooks = (perms?: string) => {
  try {
    const p = BigInt(perms ?? '0');
    return (p & PERMISSIONS.ADMINISTRATOR) !== 0n || (p & PERMISSIONS.MANAGE_WEBHOOKS) !== 0n;
  } catch {
    return false;
  }
};

/**
 * Follow an announcement relay (Discord's Follow): what it publishes is copied into a text relay
 * of one of my beacons, where I can manage webhooks.
 */
export function FollowRelayModal({ relayId }: { relayId: string }) {
  const source = useStore((s) => s.relays[relayId]);
  const sourceBeacon = useStore((s) => (source ? s.beacons[source.beaconId] : undefined));
  const beacons = useStore(useShallow((s) => s.beaconOrder.map((id) => s.beacons[id]).filter(Boolean)));
  const [beaconId, setBeaconId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const targets = useStore(
    useShallow((s) =>
      (s.relayIdsByBeacon[beaconId] ?? [])
        .map((id) => s.relays[id])
        .filter((r) => r && r.type === 'text' && r.id !== relayId && canManageWebhooks(r.myPermissions))
    )
  );
  useEffect(() => {
    if (beaconId) void loadBeacon(beaconId).catch(() => {});
    setTargetId('');
  }, [beaconId]);
  useEffect(() => {
    if (!targetId && targets[0]) setTargetId(targets[0].id);
  }, [targets, targetId]);

  const follow = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post(`/relays/${relayId}/followers`, { targetRelayId: targetId });
      toast(`Following #${source?.name}: what it publishes now appears in #${targets.find((t) => t.id === targetId)?.name}`, 'success');
      closeModal();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const select = 'h-10 w-full rounded-md border border-line bg-void px-3 text-sm text-fg';
  return (
    <Modal
      isOpen
      onClose={closeModal}
      title={`Follow #${source?.name ?? 'relay'}`}
      description={`Get what ${sourceBeacon?.name ?? 'this beacon'} publishes here in one of your ${term('beacon', true).toLowerCase()}. You can stop any time in its Integrations.`}
      maxWidth="md"
    >
      <form onSubmit={follow} className="space-y-4">
        <label className="block text-xs font-bold uppercase text-fg-muted">
          {term('beacon')}
          <select aria-label={term('beacon')} value={beaconId} onChange={(e) => setBeaconId(e.target.value)} className={`${select} mt-1.5 normal-case`} required>
            <option value="">Pick one…</option>
            {beacons.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-bold uppercase text-fg-muted">
          {term('relay')}
          <select aria-label={term('relay')} value={targetId} onChange={(e) => setTargetId(e.target.value)} className={`${select} mt-1.5 normal-case`} disabled={!beaconId || !targets.length} required>
            {targets.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.name}
              </option>
            ))}
          </select>
          {beaconId && !targets.length && <span className="mt-1 block text-xs normal-case text-fg-subtle">No text relay there where you can manage webhooks.</span>}
        </label>
        <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !targetId}>
            Follow
          </Button>
        </div>
      </form>
    </Modal>
  );
}
