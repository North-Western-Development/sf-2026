import type { CSSProperties, ReactNode } from 'react';

/**
 * Avatar decorations and profile effects (Discord's, without the shop): a fixed set anyone can
 * wear, chosen in User Settings › Profiles. The names match AVATAR_DECORATIONS / PROFILE_EFFECTS
 * in @subspace/constants; the server rejects anything else.
 */
export const DECORATION_LABELS: Record<string, string> = {
  orbit: 'Orbit',
  halo: 'Halo',
  nebula: 'Nebula',
  signal: 'Signal',
  stars: 'Starlight',
  pixel: 'Pixel Frame',
};

export const EFFECT_LABELS: Record<string, string> = {
  starfield: 'Starfield',
  aurora: 'Aurora',
  sparkle: 'Sparkle',
  scanlines: 'Scanlines',
  warp: 'Warp',
};

const star = (x: number, y: number, r: number, delay: number, fill = 'var(--color-star)') => (
  <path
    key={`${x}-${y}`}
    d={`M${x} ${y - r}L${x + r * 0.3} ${y - r * 0.3}L${x + r} ${y}L${x + r * 0.3} ${y + r * 0.3}L${x} ${y + r}L${x - r * 0.3} ${y + r * 0.3}L${x - r} ${y}L${x - r * 0.3} ${y - r * 0.3}Z`}
    fill={fill}
    style={{ transformOrigin: `${x}px ${y}px`, animation: `twinkle 2.4s ease-in-out ${delay}s infinite` }}
  />
);

/** Each decoration is drawn in a 120×120 box around a 100×100 avatar centred at (60, 60). */
const ART: Record<string, ReactNode> = {
  orbit: (
    <g style={{ transformOrigin: '60px 60px', animation: 'deco-spin 9s linear infinite' }}>
      <ellipse cx="60" cy="60" rx="57" ry="20" fill="none" stroke="var(--color-brand-sky)" strokeWidth="2.5" opacity="0.8" transform="rotate(-25 60 60)" />
      <circle cx="113" cy="40" r="5" fill="var(--color-brand-sky)" />
      <circle cx="9" cy="82" r="3.5" fill="var(--color-star)" />
    </g>
  ),
  halo: (
    <>
      <circle cx="60" cy="60" r="55" fill="none" stroke="var(--color-star)" strokeWidth="4" opacity="0.85" style={{ filter: 'drop-shadow(0 0 4px var(--color-star))' }} />
      <circle cx="60" cy="60" r="58.5" fill="none" stroke="var(--color-star-core)" strokeWidth="1" opacity="0.5" />
    </>
  ),
  nebula: (
    <>
      <defs>
        <linearGradient id="deco-nebula" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B45CFF" />
          <stop offset="0.5" stopColor="var(--color-brand)" />
          <stop offset="1" stopColor="#FF5CAA" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="55" fill="none" stroke="url(#deco-nebula)" strokeWidth="6" strokeDasharray="40 8 22 8" style={{ transformOrigin: '60px 60px', animation: 'deco-spin 14s linear infinite' }} />
    </>
  ),
  signal: (
    <>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="60" cy="60" r="52" fill="none" stroke="var(--color-brand-sky)" strokeWidth="2" style={{ transformOrigin: '60px 60px', animation: `deco-ping 2.7s ease-out ${i * 0.9}s infinite` }} />
      ))}
    </>
  ),
  stars: (
    <>
      {star(14, 22, 9, 0)}
      {star(104, 18, 6, 0.6, 'var(--color-star-core)')}
      {star(108, 96, 8, 1.2)}
      {star(10, 98, 5, 1.8, 'var(--color-brand-sky)')}
    </>
  ),
  pixel: (
    <path
      d="M10 30h10v-10h10v-10h60v10h10v10h10v60h-10v10h-10v10h-60v-10h-10v-10h-10z"
      fill="none"
      stroke="var(--color-brand)"
      strokeWidth="5"
      shapeRendering="crispEdges"
    />
  ),
};

/** The decoration around an avatar; sized from the avatar, ignores the pointer. */
export function AvatarDecoration({ name, size }: { name: string | null | undefined; size: number }) {
  if (!name || !ART[name]) return null;
  const box = size * 1.2;
  return (
    <svg
      aria-hidden
      data-decoration={name}
      viewBox="0 0 120 120"
      width={box}
      height={box}
      className="pointer-events-none absolute"
      style={{ left: (size - box) / 2, top: (size - box) / 2, overflow: 'visible' }}
    >
      {ART[name]}
    </svg>
  );
}

const EFFECT_STYLE: Record<string, CSSProperties> = {
  starfield: {
    backgroundImage:
      'radial-gradient(1.5px 1.5px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 70%, var(--color-star), transparent), radial-gradient(1px 1px at 85% 60%, #fff, transparent), radial-gradient(1px 1px at 10% 85%, var(--color-brand-sky), transparent), radial-gradient(1.5px 1.5px at 60% 45%, #fff, transparent)',
    backgroundSize: '160px 160px',
    animation: 'fx-drift 18s linear infinite',
  },
  aurora: {
    backgroundImage: 'linear-gradient(120deg, transparent 20%, rgb(61 203 255 / 0.22), rgb(180 92 255 / 0.2), rgb(80 255 170 / 0.16), transparent 80%)',
    backgroundSize: '300% 300%',
    animation: 'fx-aurora 10s ease-in-out infinite',
  },
  sparkle: {
    backgroundImage:
      'radial-gradient(2px 2px at 15% 20%, var(--color-star-core), transparent), radial-gradient(2px 2px at 80% 35%, var(--color-star), transparent), radial-gradient(2px 2px at 35% 80%, var(--color-star-core), transparent), radial-gradient(2px 2px at 65% 65%, var(--color-star), transparent)',
    animation: 'twinkle 2.2s ease-in-out infinite',
  },
  scanlines: {
    backgroundImage: 'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 4px)',
    animation: 'fx-scan 6s linear infinite',
  },
  warp: {
    backgroundImage: 'repeating-radial-gradient(circle at 50% 30%, transparent 0 18px, rgb(59 142 242 / 0.12) 18px 20px)',
    animation: 'fx-warp 4s ease-in-out infinite',
  },
};

/** A profile effect laid over a profile card (popout, full profile, settings preview). */
export function ProfileEffect({ name }: { name: string | null | undefined }) {
  if (!name || !EFFECT_STYLE[name]) return null;
  return <div aria-hidden data-profile-effect={name} className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit]" style={EFFECT_STYLE[name]} />;
}
