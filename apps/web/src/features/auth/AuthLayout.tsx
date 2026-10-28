import type { ReactNode } from 'react';
import { PixelStar } from './PixelStar';

// Fixed constellation so the backdrop is stable between renders.
const STARS = [
  { top: '9%', left: '12%', size: 22, delay: '0s' },
  { top: '18%', left: '78%', size: 30, delay: '1.2s' },
  { top: '34%', left: '6%', size: 14, delay: '2.1s' },
  { top: '62%', left: '88%', size: 18, delay: '0.6s' },
  { top: '78%', left: '18%', size: 26, delay: '1.7s' },
  { top: '86%', left: '64%', size: 12, delay: '2.6s' },
  { top: '46%', left: '94%', size: 10, delay: '3.1s' },
  { top: '6%', left: '46%', size: 12, delay: '0.9s' },
];

/** `wide` gives the card room for two columns (sign-up) on larger screens. */
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className="relative h-full w-full overflow-y-auto bg-void flex flex-col items-center px-4 py-10"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgb(59 142 242 / 0.10), transparent 70%), radial-gradient(40% 40% at 50% 100%, rgb(90 92 142 / 0.12), transparent 70%)',
        }}
      />
      {STARS.map((s, i) => (
        <PixelStar
          key={i}
          size={s.size}
          className="pointer-events-none absolute animate-[twinkle_4s_ease-in-out_infinite]"
          style={{ top: s.top, left: s.left, animationDelay: s.delay }}
        />
      ))}

      <main className={`relative mt-auto w-full ${wide ? 'max-w-[480px] md:max-w-[880px]' : 'max-w-[480px]'} animate-[rise-in_220ms_var(--ease-out-soft)]`}>
        <div className="bg-overlay rounded-2xl shadow-modal p-8">{children}</div>
      </main>

      <footer className="relative mb-auto mt-8 flex items-center gap-2 text-xs text-fg-subtle">
        <span>A transmission from</span>
        <img src="/brand/nwd-logo.png" alt="NWD" className="h-9 w-auto" draggable={false} />
      </footer>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="text-center mb-6">
      <p className="font-[family-name:var(--font-display)] text-xs font-bold uppercase tracking-[0.3em] text-brand-gradient mb-3">
        Subspace Frequency
      </p>
      <h1 className="text-2xl font-semibold text-fg">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>}
    </header>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-md bg-danger-soft border border-danger/40 px-3 py-2 text-sm text-fg">
      {message}
    </div>
  );
}
