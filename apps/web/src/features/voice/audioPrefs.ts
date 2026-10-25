import { create } from 'zustand';

/**
 * Local microphone / headphone state, mirrored into the voice session when connected.
 * Lives outside UserPanel so the voice session does not import a component module
 * (that cycle made Vite's hot reload load the session twice).
 */
export const useAudioPrefs = create<{ muted: boolean; deafened: boolean }>()(() => ({ muted: false, deafened: false }));

export function toggleMute() {
  const { muted, deafened } = useAudioPrefs.getState();
  // Unmuting while deafened also undeafens (Discord behaviour).
  if (muted && deafened) useAudioPrefs.setState({ muted: false, deafened: false });
  else useAudioPrefs.setState({ muted: !muted });
}
export function toggleDeafen() {
  const { deafened } = useAudioPrefs.getState();
  useAudioPrefs.setState(deafened ? { deafened: false, muted: false } : { deafened: true, muted: true });
}
