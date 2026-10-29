import { useEffect, useRef, useState } from 'react';
import { startScheduler } from '../features/schedule/scheduled';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { useStore } from '../data/store';
import { bootstrap, loadBeacon } from '../data/actions';
import { setBridgeNavigator, startBridge } from '../data/bridge';
import { BeaconRail } from '../features/rail/BeaconRail';
import { HomeSidebar } from '../features/sidebar/HomeSidebar';
import { BeaconSidebar } from '../features/sidebar/BeaconSidebar';
import { UserPanel } from '../features/user/UserPanel';
import { FriendsView } from '../features/home/FriendsView';
import { RequestsView } from '../features/home/RequestsView';
import { RelayRoute } from '../features/chat/RelayRoute';
import { DirectRoute } from '../features/chat/DirectRoute';
import { DiscoverView } from '../features/discover/DiscoverView';
import { DiscoverSidebar } from '../features/discover/DiscoverSidebar';
import { InviteRoute } from '../features/invite/InviteRoute';
import { TemplateRoute } from '../features/invite/TemplateRoute';
import { AuthorizePage } from '../features/oauth/AuthorizePage';
import { MembersPage } from '../features/community/MembersPage';
import { ChannelsRolesPage } from '../features/community/ChannelsRolesPage';
import { ModalHost } from './ModalHost';
import { ProfilePopoutHost } from '../features/profile/ProfilePopout';
import { Toasts } from './Toasts';
import { NoticeBar } from './NoticeBar';
import { IncomingCall } from '../features/voice/DmCall';
import { PixelStar } from '../features/auth/PixelStar';
import { clsx } from 'clsx';
import { lastPath, lastRelay, rememberPath, useUi } from './ui';
import { useSwipe } from './gestures';
import { nativeShell } from '../lib/native';
import { useIsMobile } from './mobile';
import { useGlobalShortcuts } from './shortcuts';
import { preloadEmojiSheet } from '../lib/emoji';
import { startAfkWatch } from '../features/voice/afk';
import { showWhatsNewOnce } from '../features/changelog/WhatsNew';
import { useScreenProtection } from '../lib/screenProtection';

function Boot({ children }: { children: React.ReactNode }) {
  const ready = useStore((s) => s.ready);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  useScreenProtection();

  useEffect(() => {
    setBridgeNavigator(navigate);
  }, [navigate]);

  useEffect(() => {
    const stop = startBridge();
    bootstrap().catch((err) => setError(err?.message ?? 'Failed to load'));
    return stop;
  }, []);

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-void text-fg">
        <p className="text-lg font-semibold">Could not reach the Subspace network</p>
        <p className="text-sm text-fg-muted">{error}</p>
        <button className="text-brand-sky hover:underline text-sm" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  // Once signed in and idle, fetch the emoji sheet so the picker opens fully drawn; watch for
  // idling in a comm-link (the inactive comm-link move).
  useEffect(() => {
    if (!ready) return;
    startAfkWatch();
    // What's New, once, after an update that affects this platform.
    showWhatsNewOnce();
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => preloadEmojiSheet());
    // Transmissions this device scheduled (they are kept per account, so after sign-in).
    return startScheduler();
  }, [ready]);

  if (!ready) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-void" aria-busy="true">
        <PixelStar size={40} className="animate-[twinkle_1.6s_ease-in-out_infinite]" />
        <p className="text-sm text-fg-subtle">Syncing your frequencies...</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Layout({ sidebar }: { sidebar: React.ReactNode }) {
  useGlobalShortcuts();
  const mobile = useIsMobile();
  const navOpen = useUi((s) => s.mobileNav);
  const closeNav = () => useUi.setState({ mobileNav: false });
  useRememberPath();
  // As on Discord's app, the keyboard is never up while the drawer is out.
  useEffect(() => {
    if (!mobile || !navOpen) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    // Nothing behind the drawer may take focus while it is out (a conversation opening, a reply).
    const guard = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!drawer.current?.contains(el) && el.closest?.('main')) el.blur();
    };
    document.addEventListener('focusin', guard);
    return () => document.removeEventListener('focusin', guard);
  }, [mobile, navOpen]);
  // Swipe right over the conversation to pull the drawer out; swipe left to push it back. It follows the finger.
  const root = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const DRAWER = 312;
  const SNAP = 72;
  useSwipe(root, {
    start: (dir, target) => {
      if (!mobile || !drawer.current) return false;
      const open = useUi.getState().mobileNav;
      if (open ? dir !== 'left' : dir !== 'right' || !target.closest('main')) return false;
      drawer.current.style.transition = 'none';
      drawer.current.style.boxShadow = 'var(--shadow-modal)';
      return true;
    },
    move: (dx) => {
      const open = useUi.getState().mobileNav;
      const x = open ? Math.min(0, dx) : Math.min(0, -DRAWER + dx);
      if (drawer.current) drawer.current.style.translate = `${Math.max(-DRAWER, x)}px 0`;
    },
    end: (dx, cancelled) => {
      if (drawer.current) drawer.current.style.transition = drawer.current.style.translate = drawer.current.style.boxShadow = '';
      if (cancelled) return;
      const open = useUi.getState().mobileNav;
      if (!open && dx > SNAP) useUi.setState({ mobileNav: true });
      else if (open && dx < -SNAP) closeNav();
    },
  });
  return (
    <div ref={root} className="flex h-full w-full flex-col overflow-hidden bg-void text-fg">
      <NoticeBar />
      <div className="flex min-h-0 w-full flex-1">
        {/* Rail + sidebar share one column so the user island can span both (Discord layout).
            On small screens the column is a drawer over the content. */}
        {mobile && navOpen && <div className="fixed inset-0 z-[790] bg-black/60" onClick={closeNav} aria-hidden />}
        <div
          ref={drawer}
          className={clsx(
            'flex w-[312px] shrink-0 flex-col',
            mobile ? 'fixed inset-y-0 left-0 z-[800] bg-void transition-[translate,box-shadow] duration-200' : 'relative',
            // No shadow while it is put away: it would show as a strip down the left edge.
            mobile && (navOpen ? 'shadow-modal' : '-translate-x-full shadow-none')
          )}
          aria-hidden={mobile && !navOpen ? true : undefined}
          // Picking a relay, DM or page in the sidebar closes the drawer; picking a beacon keeps it open.
          onClick={(e) => mobile && (e.target as HTMLElement).closest('aside a, aside [role="link"]') && closeNav()}
        >
          <div className="flex min-h-0 flex-1">
            <BeaconRail />
            <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-tl-xl bg-raised">
              <div className="min-h-0 flex-1">{sidebar}</div>
            </aside>
          </div>
          <UserPanel />
        </div>
        <main className="flex min-w-0 flex-1 flex-col bg-base">
          <Outlet />
        </main>
      </div>
      <IncomingCall />
      <ModalHost />
      <ProfilePopoutHost />
      <Toasts />
    </div>
  );
}

/** /channels/:beaconId with no relay: restore the last visited relay or the first text relay. */
function BeaconIndex() {
  const { beaconId = '' } = useParams();
  const relays = useStore((s) => s.relayIdsByBeacon[beaconId]);
  const known = useStore((s) => !!s.beacons[beaconId]);
  const allRelays = useStore((s) => s.relays);

  useEffect(() => {
    if (known && !relays) void loadBeacon(beaconId).catch(() => {});
  }, [beaconId, known, relays]);

  if (!known) return <Navigate to="/channels/@me" replace />;
  if (!relays) return null;
  const remembered = lastRelay(beaconId);
  const target =
    (remembered && relays.includes(remembered) && remembered) ||
    relays
      .map((id) => allRelays[id])
      .filter((r) => r && r.type !== 'category')
      .sort((a, b) => a.position - b.position)[0]?.id;
  if (!target) return <EmptyBeacon />;
  return <Navigate to={`/channels/${beaconId}/${target}`} replace />;
}

function EmptyBeacon() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
      <PixelStar size={32} />
      <p className="font-semibold text-fg">No relays yet</p>
      <p className="text-sm">Create a relay from the beacon menu to start transmitting.</p>
    </div>
  );
}

/** Where the mobile app (which always opens the instance's root) starts: the last conversation open, as on Discord's app. */
function startPath() {
  return (nativeShell() && lastPath()) || '/channels/@me';
}

function useRememberPath() {
  const { pathname } = useLocation();
  useEffect(() => rememberPath(pathname), [pathname]);
}

export function AppShell() {
  return (
    <BrowserRouter>
      <Boot>
        <Routes>
          <Route path="/" element={<Navigate to={startPath()} replace />} />
          <Route path="/invite/:code" element={<InviteRoute />} />
          <Route path="/template/:code" element={<TemplateRoute />} />
          <Route path="/oauth2/authorize" element={<AuthorizePage />} />
          <Route path="/channels/@me" element={<Layout sidebar={<HomeSidebar />} />}>
            <Route index element={<FriendsView />} />
            <Route path="requests" element={<RequestsView />} />
            <Route path=":dmId" element={<DirectRoute />} />
          </Route>
          <Route path="/discover" element={<Layout sidebar={<DiscoverSidebar />} />}>
            <Route index element={<DiscoverView />} />
          </Route>
          <Route path="/channels/:beaconId" element={<Layout sidebar={<BeaconSidebar />} />}>
            <Route index element={<BeaconIndex />} />
            <Route path="member-safety" element={<MembersPage />} />
            <Route path="channels-roles" element={<ChannelsRolesPage />} />
            <Route path=":relayId" element={<RelayRoute />} />
            <Route path=":relayId/threads/:threadId" element={<RelayRoute />} />
          </Route>
          <Route path="*" element={<Navigate to="/channels/@me" replace />} />
        </Routes>
      </Boot>
    </BrowserRouter>
  );
}
