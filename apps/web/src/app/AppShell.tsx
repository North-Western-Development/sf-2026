import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router';
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
import { InviteRoute } from '../features/invite/InviteRoute';
import { ModalHost } from './ModalHost';
import { ProfilePopoutHost } from '../features/profile/ProfilePopout';
import { Toasts } from './Toasts';
import { PixelStar } from '../features/auth/PixelStar';
import { lastRelay } from './ui';
import { useGlobalShortcuts } from './shortcuts';

function Boot({ children }: { children: React.ReactNode }) {
  const ready = useStore((s) => s.ready);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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
  return (
    <div className="flex h-full w-full overflow-hidden bg-void text-fg">
      <BeaconRail />
      <aside className="flex w-60 shrink-0 flex-col bg-raised rounded-tl-xl overflow-hidden">
        <div className="min-h-0 flex-1">{sidebar}</div>
        <UserPanel />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-base">
        <Outlet />
      </main>
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

export function AppShell() {
  return (
    <BrowserRouter>
      <Boot>
        <Routes>
          <Route path="/" element={<Navigate to="/channels/@me" replace />} />
          <Route path="/invite/:code" element={<InviteRoute />} />
          <Route path="/channels/@me" element={<Layout sidebar={<HomeSidebar />} />}>
            <Route index element={<FriendsView />} />
            <Route path="requests" element={<RequestsView />} />
            <Route path=":dmId" element={<DirectRoute />} />
          </Route>
          <Route path="/discover" element={<Layout sidebar={<HomeSidebar />} />}>
            <Route index element={<DiscoverView />} />
          </Route>
          <Route path="/channels/:beaconId" element={<Layout sidebar={<BeaconSidebar />} />}>
            <Route index element={<BeaconIndex />} />
            <Route path=":relayId" element={<RelayRoute />} />
            <Route path=":relayId/threads/:threadId" element={<RelayRoute />} />
          </Route>
          <Route path="*" element={<Navigate to="/channels/@me" replace />} />
        </Routes>
      </Boot>
    </BrowserRouter>
  );
}
