import { describe, it, expect } from 'vitest';
import { injectedBridge, normalizeServer, parseShellMessage, staysInApp } from './shell';

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
  });

  it('the injected bridge replaces Notification and posts to the shell', () => {
    const posted: string[] = [];
    const win: any = { ReactNativeWebView: { postMessage: (m: string) => posted.push(m) } };
    new Function('window', injectedBridge('ExponentPushToken[abc]', 'android'))(win);
    expect(win.subspaceNative).toMatchObject({ platform: 'android', pushToken: 'ExponentPushToken[abc]' });
    expect(win.Notification.permission).toBe('granted');
    new win.Notification('Nova', { body: 'hello', tag: 'link:1' });
    expect(JSON.parse(posted[0])).toEqual({ type: 'notify', title: 'Nova', body: 'hello', tag: 'link:1' });
  });
});
