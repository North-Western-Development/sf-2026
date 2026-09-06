/**
 * Subspace Frequency Space-Dark Design Tokens
 */

export const THEME = {
  colors: {
    void: '#07090E',            // Deepest cosmic black
    obsidian: '#0B0E14',        // Main app background
    surface: '#151922',         // Card and channel surface
    surfaceHover: '#1C222E',    // Elevated hover
    border: '#232936',          // Subdued dividers
    borderGlow: 'rgba(0, 240, 255, 0.25)', // Subtle cyan outline
    
    cyan: '#00F0FF',            // Primary quantum accent
    cyanHover: '#33F3FF',
    cyanMuted: 'rgba(0, 240, 255, 0.15)',
    
    violet: '#7928CA',          // Secondary deep space accent
    violetHover: '#9B45E8',
    violetMuted: 'rgba(121, 40, 202, 0.2)',
    
    flare: '#FF3366',           // Incident report / destructive action
    amber: '#FFB800',           // Away / Warning
    emerald: '#00FF88',         // Online / Success
    
    text: {
      primary: '#F0F4F8',
      secondary: '#94A3B8',
      muted: '#64748B',
      contrast: '#07090E',
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
