/**
 * Pure helpers for the mobile shell, kept free of React Native so they can be unit tested.
 */

export const colors = {
  void: '#030305',
  raised: '#0D0F16',
  overlay: '#131622',
  lineStrong: '#2E3350',
  brand: '#3B8EF2',
  fg: '#EEF1FA',
  fgMuted: '#A4A9C4',
  fgSubtle: '#6D7294',
  danger: '#FF4D6A',
};

/** An instance address reduced to its origin: https, or http only for local development. */
export function normalizeServer(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
    if (url.protocol === 'http:' && !local) return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Whether a navigation stays inside the app (the instance) or belongs in the browser. */
export function staysInApp(server: string, target: string): boolean {
  if (target.startsWith('about:') || target.startsWith('blob:') || target.startsWith('data:')) return true;
  try {
    return new URL(target).origin === new URL(server).origin;
  } catch {
    return false;
  }
}

/** Messages the web app sends to the shell (window.ReactNativeWebView.postMessage). */
export type ShellMessage = { type: 'notify'; title: string; body: string; tag?: string } | { type: 'ready' } | { type: 'signed-out' };

export function parseShellMessage(raw: string): ShellMessage | null {
  try {
    const m = JSON.parse(raw);
    if (m?.type === 'notify' && typeof m.title === 'string') {
      return { type: 'notify', title: m.title.slice(0, 120), body: typeof m.body === 'string' ? m.body.slice(0, 240) : '', tag: typeof m.tag === 'string' ? m.tag : undefined };
    }
    if (m?.type === 'ready' || m?.type === 'signed-out') return { type: m.type };
    return null;
  } catch {
    return null;
  }
}

export type PushTarget = { kind: 'apns'; token: string } | { kind: 'unifiedpush'; endpoint: string; p256dh: string; auth: string };

/** What the instance can send (GET /api/v1/push/config); null when it could not be asked. */
export interface PushConfig {
  apns: boolean;
  unifiedpush: boolean;
  ntfy: string | null;
}

/** Whether this install gets pushes, and in words for the settings page when it does not. */
export interface PushState {
  target: PushTarget | null;
  status: 'on' | 'waiting' | 'unavailable';
  reason: string;
}

const CLOSED = 'Notifications arrive only while Subspace is open.';

export function iosPushState(config: PushConfig | null, permission: boolean, token: string | null): PushState {
  const off = (reason: string): PushState => ({ target: null, status: 'unavailable', reason });
  if (!config) return off(`Could not ask this server about push. ${CLOSED}`);
  if (!config.apns) return off(`This server has no Apple push key set up. ${CLOSED}`);
  if (!permission) return off('Notifications are turned off for Subspace in iOS Settings.');
  // Sideloaded builds lack the push entitlement, so iOS never hands them a token.
  if (!token) return off(`This copy of the app cannot receive push (sideloaded builds cannot). ${CLOSED}`);
  return { target: { kind: 'apns', token }, status: 'on', reason: 'Push notifications come through Apple. They say only that something arrived, never who sent it or what it says.' };
}

export function androidPushState(config: PushConfig | null, permission: boolean, distributors: number, endpoint: { endpoint: string; p256dh: string; auth: string } | null): PushState {
  const ntfy = config?.ntfy ? ` and set its server to ${config.ntfy}` : '';
  if (!permission) return { target: null, status: 'unavailable', reason: 'Notifications are turned off for Subspace in Android settings.' };
  if (!distributors) return { target: null, status: 'unavailable', reason: `Install a UnifiedPush app such as ntfy${ntfy} to get notifications while Subspace is closed.` };
  if (!endpoint) return { target: null, status: 'waiting', reason: 'Waiting for your UnifiedPush app to connect.' };
  let host = endpoint.endpoint;
  try {
    host = new URL(endpoint.endpoint).host;
  } catch {}
  return {
    target: { kind: 'unifiedpush', ...endpoint },
    status: 'on',
    reason: `Push notifications come through UnifiedPush (${host}), encrypted so only this phone can read them.`,
  };
}

/** Hands a new push state to the page that is already open. */
export const pushUpdateScript = (state: PushState) =>
  `(function () { if (!window.subspaceNative) return; window.subspaceNative.push = ${JSON.stringify(state.target)}; window.subspaceNative.pushStatus = ${JSON.stringify({ status: state.status, reason: state.reason })}; window.dispatchEvent(new Event('subspace-native-push')); })(); true;`;

/**
 * Runs in the page before the web app: tells it it is inside the native shell, and routes the
 * web Notification API (which mobile WebViews lack) to native notifications.
 */
export function injectedBridge(push: PushState, platform: string): string {
  return `(function () {
  if (window.subspaceNative) return;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  window.subspaceNative = { platform: ${JSON.stringify(platform)}, push: ${JSON.stringify(push.target)}, pushStatus: ${JSON.stringify({ status: push.status, reason: push.reason })}, post: post };
  function NativeNotification(title, options) {
    post({ type: 'notify', title: String(title), body: options && options.body ? String(options.body) : '', tag: options && options.tag ? String(options.tag) : undefined });
    this.onclick = null;
  }
  NativeNotification.permission = 'granted';
  NativeNotification.requestPermission = function () { return Promise.resolve('granted'); };
  NativeNotification.prototype.close = function () {};
  window.Notification = NativeNotification;
})(); true;`;
}
