import { useEffect, useState } from 'react';
import { Button, ComingSoon, Modal } from '@subspace/ui';
import { useStore } from '../../data/store';
import { closeModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { Switch } from '../settings/SettingsLayout';

/** Discord's per-server Privacy Settings, from the beacon's menu. */
export function BeaconPrivacyModal({ beaconId }: { beaconId: string }) {
  const name = useStore((s) => s.beacons[beaconId]?.name ?? '');
  const [allowDms, setAllowDms] = useState<boolean | null>(null);

  useEffect(() => {
    http
      .get<{ privacy: { allowDms: boolean } }>(`/beacons/${beaconId}/members/@me/privacy`)
      .then((r) => setAllowDms(r.privacy.allowDms))
      .catch((e) => toast((e as Error).message, 'error'));
  }, [beaconId]);

  const saveDms = async (v: boolean) => {
    setAllowDms(v);
    try {
      await http.patch(`/beacons/${beaconId}/members/@me`, { allowDms: v });
    } catch (e) {
      setAllowDms(!v);
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal
      isOpen
      onClose={closeModal}
      title={`Privacy Settings—${name}`}
      maxWidth="md"
      footer={
        <Button className="w-full" onClick={closeModal} data-autofocus>
          Done
        </Button>
      }
    >
      <Switch
        label={term('link', true)}
        description={`Allow ${term('link', true).toLowerCase()} from other members of this ${term('beacon').toLowerCase()}. ${term('affiliate', true)} can always reach you.`}
        checked={allowDms ?? true}
        disabled={allowDms === null}
        onChange={(v) => void saveDms(v)}
      />
      {/* Discord has these too; nothing behind them yet. */}
      <ComingSoon className="block w-full">
        <div className="w-full">
          <Switch label="Message requests" description={`Filter ${term('link', true).toLowerCase()} from members you may not know.`} checked onChange={() => {}} />
          <Switch label="Share my activity" description="Share activity information from games and connected apps you use." checked={false} onChange={() => {}} />
          <Switch label="Activity joining" description={`Allow members to join your activity in this ${term('beacon').toLowerCase()}.`} checked={false} onChange={() => {}} />
        </div>
      </ComingSoon>
    </Modal>
  );
}
