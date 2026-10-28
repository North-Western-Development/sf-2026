import { PermissionsAndroid, Platform } from 'react-native';
import { SubspacePush } from '../modules/subspace-push';
import { androidPushState, iosPushState, type PushConfig, type PushState } from './shell';

/**
 * Push without a third-party relay: iOS asks Apple for a device token (expo-notifications, which
 * here talks to APNs only), Android registers with the person's UnifiedPush distributor
 * (modules/subspace-push). expo-notifications is not linked on Android, because it brings in
 * Firebase; see package.json.
 */
const Notifications = Platform.OS === 'ios' ? (require('expo-notifications') as typeof import('expo-notifications')) : null;

Notifications?.setNotificationHandler({
  // Pushes from the server are not shown while the app is open: the open page shows its own.
  handleNotification: async (n) => {
    const remote = (n.request.trigger as { type?: string } | null)?.type === 'push';
    return { shouldShowBanner: !remote, shouldShowList: !remote, shouldPlaySound: !remote, shouldSetBadge: false };
  },
});

async function pushConfig(server: string): Promise<PushConfig | null> {
  try {
    const res = await fetch(`${server}/api/v1/push/config`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as PushConfig) : null;
  } catch {
    return null;
  }
}

const within = <T,>(ms: number, p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Works out this install's push, and calls `onChange` whenever it changes. Returns a stop function. */
export function startPush(server: string, onChange: (state: PushState) => void): () => void {
  let stopped = false;
  const emit = (s: PushState) => !stopped && onChange(s);
  const subs: Array<{ remove(): void }> = [];

  void (async () => {
    const config = await pushConfig(server);
    if (Platform.OS === 'ios' && Notifications) {
      const permission = (await Notifications.requestPermissionsAsync().catch(() => null))?.granted ?? false;
      let token: string | null = null;
      if (config?.apns && permission) {
        token = (await within(10_000, Notifications.getDevicePushTokenAsync().catch(() => null)))?.data ?? null;
      }
      emit(iosPushState(config, permission, typeof token === 'string' ? token : null));
      return;
    }
    const up = SubspacePush;
    if (!up) return emit({ target: null, status: 'unavailable', reason: 'Push is not supported on this device.' });
    let permission = true;
    if (Number(Platform.Version) >= 33) {
      permission = (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => 'denied')) === 'granted';
    }
    const update = () => emit(androidPushState(config, permission, up.distributors().length, up.endpoint()));
    subs.push(up.addListener('onEndpoint', update));
    update();
    // Registering again is harmless and picks up a changed endpoint or distributor.
    if (permission && (await up.register()) === 'no-distributor') update();
  })();

  return () => {
    stopped = true;
    subs.forEach((s) => s.remove());
  };
}

/** A notification the open page asked for. */
export function showLocal(title: string, body: string) {
  if (Notifications) void Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }).catch(() => {});
  else SubspacePush?.notify(title, body, null);
}

/** Calls `open` with the path of each notification the person taps, including the one that launched the app. */
export function onNotificationOpen(open: (path: string) => void): () => void {
  const safe = (p: unknown) => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && open(p);
  if (Notifications) {
    void Notifications.getLastNotificationResponseAsync().then((r) => r && safe(r.notification.request.content.data?.path));
    const sub = Notifications.addNotificationResponseReceivedListener((r) => safe(r.notification.request.content.data?.path));
    return () => sub.remove();
  }
  if (!SubspacePush) return () => {};
  safe(SubspacePush.takeLaunchPath());
  const sub = SubspacePush.addListener('onOpen', (e) => safe(e.path));
  return () => sub.remove();
}
