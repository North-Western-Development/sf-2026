import { create } from 'zustand';

/** Per-device chat display preferences (User Settings → Chat). */
export interface ChatPrefs {
  /** Show link previews under transmissions. */
  showEmbeds: boolean;
  /** Show images and videos inline; otherwise as file cards. */
  inlineMedia: boolean;
}

const KEY = 'subspace_chat_prefs';
const defaults: ChatPrefs = { showEmbeds: true, inlineMedia: true };

const read = (): ChatPrefs => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
};

export const useChatPrefs = create<ChatPrefs>()(read);

export function setChatPrefs(patch: Partial<ChatPrefs>) {
  useChatPrefs.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useChatPrefs.getState()));
  } catch {
    /* storage unavailable */
  }
}
