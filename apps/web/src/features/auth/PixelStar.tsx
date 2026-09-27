import { useId } from 'react';

/** Stepped four-point star from the NWD mark. */
export function PixelStar({
  size = 24,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  // 9x9 grid: long arms, stepped shoulders, 3x3 core.
  const d =
    'M4 0h1v2h1v1h1v1h2v1h-2v1h-1v1h-1v2h-1v-2h-1v-1h-1v-1h-2v-1h2v-1h1v-1h1z';
  return (
    <svg
      width={size}
      height={size}
      viewBox="-0.5 -0.5 10 10"
      className={className}
      style={style}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <defs>
        <radialGradient id={`${id}-g`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="var(--color-star-core)" />
          <stop offset="18%" stopColor="var(--color-star-core)" />
          <stop offset="55%" stopColor="var(--color-star)" />
          <stop offset="100%" stopColor="var(--color-star)" />
        </radialGradient>
      </defs>
      <path d={d} fill={`url(#${id}-g)`} stroke="var(--color-halo)" strokeWidth="0.45" strokeLinejoin="round" />
    </svg>
  );
}
