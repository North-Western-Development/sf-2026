/**
 * Subspace design tokens (JS mirror of the CSS @theme tokens)
 */

export const THEME = {
  // Mirrors the @theme tokens in apps/web/src/index.css (NWD palette on deep black).
  colors: {
    void: '#030305',
    base: '#07080C',
    raised: '#0D0F16',
    overlay: '#131622',
    hover: '#1A1E2E',
    line: '#1F2336',
    brandSky: '#3DCBFF',
    brand: '#3B8EF2',
    brandStrong: '#3353D6',
    star: '#FFF36B',
    halo: '#5A5C8E',
    online: '#3DDC84',
    idle: '#FFD34D',
    danger: '#FF4D6A',
    text: {
      primary: '#EEF1FA',
      secondary: '#A4A9C4',
      muted: '#6D7294',
    },
  },
  fonts: [
    { id: 'default', name: 'Inter (Standard)', family: 'Inter, system-ui, sans-serif' },
    { id: 'orbitron', name: 'Orbitron (Space Combat)', family: 'Orbitron, sans-serif' },
    { id: 'rajdhani', name: 'Rajdhani (Cyber Technical)', family: 'Rajdhani, sans-serif' },
    { id: 'space_grotesk', name: 'Space Grotesk (Modernist)', family: '"Space Grotesk", sans-serif' },
    { id: 'jetbrains', name: 'JetBrains Mono (Console)', family: '"JetBrains Mono", monospace' },
  ],
} as const;

export type ThemeColors = typeof THEME.colors;
