import { describe, it, expect } from 'vitest';
import { androidPushState, injectedBridge, iosPushState, normalizeServer, parseShellMessage, pushUpdateScript, staysInApp, type PushState } from './shell';

describe('mobile shell helpers', () => {
  it('accepts https instances and local http only, reduced to the origin', () => {
    expect(normalizeServer('subspace.example.com/channels/@me')).toBe('https://subspace.example.com');
    expect(normalizeServer('  https://subspace.example.com:8443/x?y  ')).toBe('https://subspace.example.com:8443');
    expect(normalizeServer('http://10.0.2.2:5173')).toBe('http://10.0.2.2:5173');
    expect(normalizeServer('http://subspace.example.com')).toBeNull();
    expect(normalizeServer('javascript:alert(1)')).toBeNull();
    expect(normalizeServer('')).toBeNull();
  });

  it('keeps the instance in the app and sends everything else to the browser', () => {
    const server = 'https://subspace.example.com';
    expect(staysInApp(server, 'https://subspace.example.com/channels/@me')).toBe(true);
    expect(staysInApp(server, 'about:blank')).toBe(true);
    expect(staysInApp(server, 'https://subspace.example.com.evil.net/')).toBe(false);
    expect(staysInApp(server, 'http://subspace.example.com/')).toBe(false);
    expect(staysInApp(server, 'https://youtube.com/watch?v=1')).toBe(false);
  });

  it('only understands well-formed messages from the page, and caps their size', () => {
    expect(parseShellMessage('{"type":"notify","title":"Nova","body":"hi","tag":"link:1"}')).toEqual({ type: 'notify', title: 'Nova', body: 'hi', tag: 'link:1' });
    expect(parseShellMessage(JSON.stringify({ type: 'notify', title: 'x'.repeat(500), body: 'y'.repeat(500) }))).toMatchObject({ title: 'x'.repeat(120), body: 'y'.repeat(240) });
    expect(parseShellMessage('{"type":"run","code":"evil()"}')).toBeNull();
    expect(parseShellMessage('not json')).toBeNull();
    // Screenshot protection: only a real boolean turns it on or off.
    expect(parseShellMessage('{"type":"secure","on":true}')).toEqual({ type: 'secure', on: true });
    expect(parseShellMessage('{"type":"secure","on":false}')).toEqual({ type: 'secure', on: false });
    expect(parseShellMessage('{"type":"secure","on":"yes"}')).toBeNull();
    expect(parseShellMessage('{"type":"secure"}')).toBeNull();
  });

  it('the injected bridge replaces Notification and posts to the shell', () => {
    const posted: string[] = [];
    const win: any = { ReactNativeWebView: { postMessage: (m: string) => posted.push(m) } };
    const push: PushState = { target: { kind: 'apns', token: 'ab'.repeat(32) }, status: 'on', reason: 'r' };
    new Function('window', injectedBridge(push, 'ios'))(win);
    expect(win.subspaceNative).toMatchObject({ platform: 'ios', push: push.target, pushStatus: { status: 'on', reason: 'r' } });
    expect(win.Notification.permission).toBe('granted');
    new win.Notification('Nova', { body: 'hello', tag: 'link:1' });
    expect(JSON.parse(posted[0])).toEqual({ type: 'notify', title: 'Nova', body: 'hello', tag: 'link:1' });
  });

  it('a new push state reaches the open page', () => {
    const events: string[] = [];
    const win: any = { subspaceNative: { push: null }, dispatchEvent: (e: Event) => events.push(e.type) };
    const state: PushState = { target: { kind: 'unifiedpush', endpoint: 'https://push.example/up1', p256dh: 'k', auth: 'a' }, status: 'on', reason: 'r' };
    new Function('window', pushUpdateScript(state))(win);
    expect(win.subspaceNative.push).toEqual(state.target);
    expect(events).toEqual(['subspace-native-push']);
  });

  it('says why iOS push is unavailable', () => {
    const config = { apns: true, unifiedpush: true, ntfy: null };
    expect(iosPushState(null, true, 'ab').status).toBe('unavailable');
    expect(iosPushState({ ...config, apns: false }, true, 'ab').reason).toMatch(/no Apple push key/);
    expect(iosPushState(config, false, 'ab').reason).toMatch(/iOS Settings/);
    expect(iosPushState(config, true, null).reason).toMatch(/sideloaded/);
    expect(iosPushState(config, true, 'ab')).toMatchObject({ status: 'on', target: { kind: 'apns', token: 'ab' } });
  });

  it("points Android at a UnifiedPush app, and this server's ntfy", () => {
    const config = { apns: false, unifiedpush: true, ntfy: 'https://push.subspace.click' };
    expect(androidPushState(config, true, 0, null).reason).toContain('ntfy and set its server to https://push.subspace.click');
    expect(androidPushState(config, true, 1, null).status).toBe('waiting');
    expect(androidPushState(config, false, 1, null).status).toBe('unavailable');
    const on = androidPushState(config, true, 1, { endpoint: 'https://push.subspace.click/upX?up=1', p256dh: 'k', auth: 'a' });
    expect(on).toMatchObject({ status: 'on', target: { kind: 'unifiedpush', endpoint: 'https://push.subspace.click/upX?up=1' } });
    expect(on.reason).toMatch(/push.subspace.click/);
  });
});
