import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { useUi } from './ui';

/** Phones and narrow windows (the mobile app's WebView): one pane at a time. */
const QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const update = () => setMobile(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

/** Opens the beacon rail and sidebar as a drawer on small screens; hidden on wider ones. */
export function MobileNavButton() {
  return (
    <button
      type="button"
      aria-label="Open navigation"
      onClick={() => useUi.setState({ mobileNav: true })}
      className="-ml-1 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg md:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}

/** A right-hand panel (members, profile, search results) as an overlay on small screens. */
export function MobileSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-[740] bg-black/60 md:hidden" onClick={onClose} aria-hidden />
      <div className="fixed inset-y-0 right-0 z-[750] flex w-[min(420px,88vw)] [&>aside]:w-full [&>aside]:max-w-none">{children}</div>
    </>
  );
}
