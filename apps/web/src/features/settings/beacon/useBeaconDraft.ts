import { useEffect, useMemo, useState } from 'react';
import { useStore, setState } from '../../../data/store';
import { http } from '../../../lib/http';
import { toBeacon } from '../../../lib/normalize';
import { toast } from '../../../app/ui';
import type { Beacon } from '../../../lib/types';

/**
 * Edits some of a beacon's settings behind the SaveBar: `d` is the draft, `dirty` says when it
 * differs from what is saved, and `save` sends only those fields.
 */
export function useBeaconDraft<K extends keyof Beacon>(beaconId: string, keys: readonly K[]) {
  const beacon = useStore((s) => s.beacons[beaconId]);
  const initial = useMemo(() => Object.fromEntries(keys.map((k) => [k, beacon?.[k] ?? null])) as Pick<Beacon, K>, [beacon]); // eslint-disable-line react-hooks/exhaustive-deps
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setD(initial), [initial]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const set = <F extends K>(key: F, value: Beacon[F]) => setD((x) => ({ ...x, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const changed = Object.fromEntries(keys.filter((k) => JSON.stringify(d[k]) !== JSON.stringify(initial[k])).map((k) => [k, d[k]]));
      const res = await http.patch<{ beacon: any }>(`/beacons/${beaconId}`, changed);
      setState((s) => ({ beacons: { ...s.beacons, [beaconId]: { ...s.beacons[beaconId], ...toBeacon(res.beacon) } } }));
      toast('Changes saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return { d, set, dirty, saving, save, reset: () => setD(initial) };
}
