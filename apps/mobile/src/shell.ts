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

/**
 * Runs in the page before the web app: tells it it is inside the native shell, and routes the
 * web Notification API (which mobile WebViews lack) to native notifications.
 */
export function injectedBridge(pushToken: string | null, platform: string): string {
  return `(function () {
  if (window.subspaceNative) return;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  window.subspaceNative = { platform: ${JSON.stringify(platform)}, pushToken: ${JSON.stringify(pushToken)}, post: post };
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
