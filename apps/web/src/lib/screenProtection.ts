import { useEffect } from 'react';
import { useStore } from '../data/store';
import { parseChannelKey } from './types';
import { nativeShell } from './native';
import { useVoice } from '../features/voice/session';

/**
 * Screenshot protection while an end-to-end encrypted direct link or group DM is open (not
 * during voice or a call, where it would black out screen sharing). The desktop app hides its
 * window from screenshots and screen capture; the mobile app sets Android's FLAG_SECURE and
 * blocks capture on iOS. Browsers have no way to do this, so there it does nothing.
 */

/** The desktop app's reserved address for this: it intercepts the navigation and never loads it. */
export const DESKTOP_PROTECTION_URL = 'https://subspace-desktop.invalid/content-protection';

type DesktopShell = { subspaceDesktop?: boolean; subspaceDesktopFeatures?: string[] };

let applied = false;

export function setScreenProtection(on: boolean) {
  if (on === applied) return;
  applied = on;
  const shell = nativeShell();
  if (shell) {
    shell.post({ type: 'secure', on });
    return;
  }
  // Only desktop versions that announce the feature: older ones would open the address in the browser.
  const w = window as unknown as DesktopShell;
  if (w.subspaceDesktop && w.subspaceDesktopFeatures?.includes('content-protection')) {
    window.location.assign(`${DESKTOP_PROTECTION_URL}?on=${on ? 1 : 0}`);
  }
}

/** Whether the open conversation is an encrypted direct link or group DM. */
function useEncryptedConversationOpen() {
  return useStore((s) => {
    if (!s.activeChannel) return false;
    const { type, id } = parseChannelKey(s.activeChannel);
    if (type === 'link') return !!s.links[id]?.encryptedAt;
    if (type === 'mesh') return !!s.meshes[id]?.encryptedAt;
    return false;
  });
}

/** Mounted once in the signed-in app. */
export function useScreenProtection() {
  const encrypted = useEncryptedConversationOpen();
  const inVoice = useVoice((v) => v.state !== 'idle');
  const want = encrypted && !inVoice;
  useEffect(() => setScreenProtection(want), [want]);
  // Signing out (the app unmounts) always lifts it.
  useEffect(() => () => setScreenProtection(false), []);
}
