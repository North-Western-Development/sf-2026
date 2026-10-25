import { useEffect, useState } from 'react';
import { Button, Modal } from '@subspace/ui';
import { useStore } from '../../data/store';
import { closeModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { Switch } from '../settings/SettingsLayout';

interface Privacy {
  allowDms: boolean;
  messageRequests: boolean;
  shareActivity: boolean;
  activityJoining: boolean;
}

/** Discord's per-server Privacy Settings, from the beacon's menu. Each switch saves at once. */
export function BeaconPrivacyModal({ beaconId }: { beaconId: string }) {
  const name = useStore((s) => s.beacons[beaconId]?.name ?? '');
  const [p, setP] = useState<Privacy | null>(null);

  useEffect(() => {
    http
      .get<{ privacy: Privacy }>(`/beacons/${beaconId}/members/@me/privacy`)
      .then((r) => setP(r.privacy))
      .catch((e) => toast((e as Error).message, 'error'));
  }, [beaconId]);

  const save = async (key: keyof Privacy, v: boolean) => {
    setP((x) => (x ? { ...x, [key]: v } : x));
    try {
      await http.patch(`/beacons/${beaconId}/members/@me`, { [key]: v });
    } catch (e) {
      setP((x) => (x ? { ...x, [key]: !v } : x));
      toast((e as Error).message, 'error');
    }
  };

  const links = term('link', true).toLowerCase();
  const beacon = term('beacon').toLowerCase();
  // Message requests only matter while DMs are allowed; joining only while the activity is shown.
  const locked = (key: keyof Privacy) => !p || (key === 'messageRequests' && !p.allowDms) || (key === 'activityJoining' && !p.shareActivity);
  const row = (key: keyof Privacy, label: string, description: string) => (
    <Switch label={label} description={description} checked={p?.[key] ?? false} disabled={locked(key)} onChange={(v) => void save(key, v)} />
  );

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
      {row('allowDms', term('link', true), `Allow ${links} from other members of this ${beacon}. ${term('affiliate', true)} can always reach you.`)}
      {row(
        'messageRequests',
        'Message requests',
        `Send first ${links} from members who are not ${term('affiliate', true).toLowerCase()} to Message Requests, where you can accept or ignore them.`
      )}
      {row('shareActivity', 'Share my activity', `Show members of this ${beacon} the activity you are in.`)}
      {row('activityJoining', 'Activity joining', `Let members of this ${beacon} join your activity from your profile.`)}
    </Modal>
  );
}
