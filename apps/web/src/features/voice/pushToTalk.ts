import { getState, useStore } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { gateway } from '../../services/gateway';
import { rtcManager } from '../../services/rtc';
import { usePushToTalk } from '../../lib/voicePrefs';
import { useVoice } from './session';

/**
 * Comm-link rules that come from permissions: no Use Voice Activity means push-to-talk only, and
 * Priority Speaker's key raises the flag the gateway passes on (after checking the permission).
 * Whoever hears a priority speaker talking plays everyone else quieter.
 */
function sync() {
  const { relayId, state } = useVoice.getState();
  const s = getState();
  const inLink = !!relayId && state !== 'idle';
  const perms = inLink ? relayPermissions(s, relayId!) : null;
  const forced = !!perms && !can(perms, PERMISSIONS.USE_VOICE_ACTIVITY);
  if (usePushToTalk.getState().forced !== forced) usePushToTalk.setState({ forced });
  gateway.setPriority(inLink && !!perms && can(perms, PERMISSIONS.PRIORITY_SPEAKER) && usePushToTalk.getState().priorityHeld);

  const me = s.me?.id;
  const speaking = new Set(useVoice.getState().speaking);
  const talkers = inLink ? Object.values(s.voice).filter((v) => v.relayId === relayId && v.isPriority && v.transmitterId !== me && speaking.has(v.transmitterId)).map((v) => v.transmitterId) : [];
  rtcManager.setPriorityTalkers(talkers);
}
useStore.subscribe(sync);
useVoice.subscribe(sync);
usePushToTalk.subscribe(sync);
