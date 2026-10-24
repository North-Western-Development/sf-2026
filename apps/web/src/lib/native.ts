import { http } from './http';

/** What the mobile app (apps/mobile) injects before this page loads; absent in browsers and on desktop. */
interface NativeShell {
  platform: 'ios' | 'android' | string;
  pushToken: string | null;
  post: (message: unknown) => void;
}

export const nativeShell = (): NativeShell | null => (window as unknown as { subspaceNative?: NativeShell }).subspaceNative ?? null;

/** Signed in inside the mobile app: let the server push notifications to this install. */
export function registerPushToken() {
  const shell = nativeShell();
  if (!shell?.pushToken) return;
  const platform = ['ios', 'android'].includes(shell.platform) ? shell.platform : 'unknown';
  void http.post('/push/tokens', { token: shell.pushToken, platform }).catch(() => {});
}

/** Signing out: stop pushes to this install for the account. */
export async function unregisterPushToken() {
  const shell = nativeShell();
  if (!shell?.pushToken) return;
  await http.post('/push/tokens/remove', { token: shell.pushToken }).catch(() => {});
  shell.post({ type: 'signed-out' });
}
