import { http } from './http';

type PushTarget = { kind: 'apns'; token: string } | { kind: 'unifiedpush'; endpoint: string; p256dh: string; auth: string };

/** What the mobile app (apps/mobile) injects before this page loads; absent in browsers and on desktop. */
interface NativeShell {
  platform: 'ios' | 'android' | string;
  /** Where the server can push to this install, once known; it can change (see NATIVE_PUSH_EVENT). */
  push: PushTarget | null;
  /** Why push is on or not, in words for the settings page. */
  pushStatus?: { status: 'on' | 'waiting' | 'unavailable'; reason: string };
  post: (message: unknown) => void;
}

/** Fired on window when the app's push target or status changes. */
export const NATIVE_PUSH_EVENT = 'subspace-native-push';

export const nativeShell = (): NativeShell | null => (window as unknown as { subspaceNative?: NativeShell }).subspaceNative ?? null;

/** Running inside the desktop or mobile app (they open the app itself, never the homepage). */
export const inAppShell = () => !!nativeShell() || !!(window as unknown as { subspaceDesktop?: boolean }).subspaceDesktop;

const pushKey = (p: PushTarget) => (p.kind === 'apns' ? p.token : p.endpoint);
let signedIn = false;
let listening = false;

/** Signed in inside the mobile app: let the server push to this install (again whenever that changes). */
export function registerPushToken() {
  const shell = nativeShell();
  if (!shell) return;
  signedIn = true;
  if (!listening) {
    listening = true;
    window.addEventListener(NATIVE_PUSH_EVENT, () => signedIn && registerPushToken());
  }
  if (shell.push) void http.post('/push/tokens', shell.push).catch(() => {});
}

/** Signing out: stop pushes to this install for the account. */
export async function unregisterPushToken() {
  const shell = nativeShell();
  signedIn = false;
  if (!shell) return;
  if (shell.push) await http.post('/push/tokens/remove', { token: pushKey(shell.push) }).catch(() => {});
  shell.post({ type: 'signed-out' });
}
