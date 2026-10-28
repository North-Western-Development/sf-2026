import { create } from 'zustand';

/**
 * Local microphone / headphone state, mirrored into the voice session when connected.
 * Lives outside UserPanel so the voice session does not import a component module
 * (that cycle made Vite's hot reload load the session twice).
 */
export const useAudioPrefs = create<{ muted: boolean; deafened: boolean; serverMuted?: boolean; serverDeafened?: boolean }>()(() => ({ muted: false, deafened: false }));

/** A moderator's server mute or deafen (see moderation.ts) keeps these down until lifted. */
function held(unmuting: boolean) {
  const { serverMuted, serverDeafened } = useAudioPrefs.getState();
  if (unmuting && (serverMuted || serverDeafened)) {
    // Imported lazily: ui pulls in a lot, and this module must stay light.
    void import('../../app/ui').then(({ toast }) => toast(serverDeafened ? 'A moderator deafened you in this beacon.' : 'A moderator muted you in this beacon.', 'warning'));
    return true;
  }
  return false;
}

export function toggleMute() {
  const { muted, deafened } = useAudioPrefs.getState();
  if (held(muted)) return;
  // Unmuting while deafened also undeafens (Discord behaviour).
  if (muted && deafened) useAudioPrefs.setState({ muted: false, deafened: false });
  else useAudioPrefs.setState({ muted: !muted });
}
export function toggleDeafen() {
  const { deafened } = useAudioPrefs.getState();
  if (deafened && useAudioPrefs.getState().serverDeafened && held(true)) return;
  useAudioPrefs.setState(deafened ? { deafened: false, muted: false } : { deafened: true, muted: true });
}
