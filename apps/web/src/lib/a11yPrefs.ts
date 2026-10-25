import { create } from 'zustand';

/** Per-device accessibility preferences (User Settings › Accessibility), applied to the page. */
export interface A11yPrefs {
  /** 0-100: how saturated colours are (Discord's Saturation). */
  saturation: number;
  /** Always underline links in transmissions. */
  underlineLinks: boolean;
  /** 'auto' follows the system; 'on' turns animations off everywhere. */
  reducedMotion: 'auto' | 'on';
  /** Show clearance colours on names. */
  roleColors: boolean;
  /** A send button in the message box, for people who prefer clicking. */
  sendButton: boolean;
}

const KEY = 'subspace_a11y_prefs';
const defaults: A11yPrefs = { saturation: 100, underlineLinks: false, reducedMotion: 'auto', roleColors: true, sendButton: false };

const read = (): A11yPrefs => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
};

export const useA11yPrefs = create<A11yPrefs>()(read);

/** Puts the preferences on <html> so CSS can follow them (see index.css). */
export function applyA11yPrefs(p: A11yPrefs = useA11yPrefs.getState()) {
  const root = document.documentElement;
  // On <html>, so popovers in portals are included and fixed positioning is unaffected.
  root.style.filter = p.saturation < 100 ? `saturate(${p.saturation / 100})` : '';
  root.dataset.underlineLinks = String(p.underlineLinks);
  root.dataset.reducedMotion = p.reducedMotion;
}

export function setA11yPrefs(patch: Partial<A11yPrefs>) {
  useA11yPrefs.setState(patch);
  applyA11yPrefs();
  try {
    localStorage.setItem(KEY, JSON.stringify(useA11yPrefs.getState()));
  } catch {
    /* storage unavailable */
  }
}
