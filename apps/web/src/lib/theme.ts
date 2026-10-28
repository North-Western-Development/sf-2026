import { create } from 'zustand';

/**
 * App themes (User Settings › Appearance), per device. Deep Space is the default; AMOLED is
 * true black for OLED screens, with the deeper cobalt from the NWD lettering as its accent.
 * The tokens for each live in index.css under html[data-theme].
 */
export const THEMES = [
  { id: 'deep-space', name: 'Deep Space', frame: '#030305' },
  { id: 'amoled', name: 'AMOLED', frame: '#000000' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'subspace_theme';
const read = (): ThemeId => {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : 'deep-space';
  } catch {
    return 'deep-space';
  }
};

export const useTheme = create<{ theme: ThemeId }>()(() => ({ theme: read() }));

/** Before the first paint, and whenever it changes. */
export function applyTheme(theme: ThemeId = useTheme.getState().theme) {
  const root = document.documentElement;
  if (theme === 'deep-space') delete root.dataset.theme;
  else root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES.find((t) => t.id === theme)!.frame);
}

export function setTheme(theme: ThemeId) {
  useTheme.setState({ theme });
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private window: this session only */
  }
  applyTheme(theme);
}
