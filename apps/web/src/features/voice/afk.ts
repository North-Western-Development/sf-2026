import { getState } from '../../data/store';
import { toast } from '../../app/ui';
import { term } from '../../lib/strings';
import { joinVoice, useVoice } from './session';
import { useAudioPrefs } from './audioPrefs';

/**
 * Discord's inactive channel: someone idle in a beacon's comm-link for longer than its timeout
 * moves to the beacon's inactive comm-link, muted. Idle means no input in Subspace.
 */
export function afkTarget(opts: { relayId: string | null; afkChannelId: string | null | undefined; afkTimeout: number; idleMs: number }): string | null {
  const { relayId, afkChannelId, afkTimeout, idleMs } = opts;
  if (!relayId || !afkChannelId || relayId === afkChannelId) return null;
  return idleMs >= afkTimeout * 1000 ? afkChannelId : null;
}

let lastInput = Date.now();
let started = false;

export function startAfkWatch() {
  if (started) return;
  started = true;
  const touch = () => (lastInput = Date.now());
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true });
  setInterval(() => {
    const { relayId, beaconId } = useVoice.getState();
    if (!beaconId) return;
    const beacon = getState().beacons[beaconId];
    const target = afkTarget({ relayId, afkChannelId: beacon?.afkChannelId, afkTimeout: beacon?.afkTimeout ?? 300, idleMs: Date.now() - lastInput });
    if (!target) return;
    useAudioPrefs.setState({ muted: true });
    void joinVoice(target, beaconId);
    toast(`You were moved to the inactive ${term('commLink').toLowerCase()} after being idle.`);
  }, 15_000);
}
