import { describe, it, expect } from 'vitest';
import { ACTIVITY_SANDBOX, frameSrcFor } from '../features/voice/CustomActivity';

/** The client's own check on a custom Activity's URL before it frames it (the API checks too). */
describe('frameSrcFor', () => {
  const frame = 'a'.repeat(32);
  const here = window.location.origin; // jsdom: http://localhost:3000

  it('frames a foreign https page, with the handshake in the fragment', () => {
    const r = frameSrcFor('https://game.example/play?mode=1', frame, '42')!;
    expect(r.origin).toBe('https://game.example');
    const url = new URL(r.src);
    expect(url.search).toBe('?mode=1');
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({ frame_id: frame, parent_origin: here, instance_id: '42' });
  });

  it('refuses our own origin and host, http elsewhere, credentials and other schemes', () => {
    expect(frameSrcFor(`${here}/activity`, frame, '1')).toBeNull();
    expect(frameSrcFor('http://localhost:9999/activity', frame, '1')).toBeNull(); // same host, other port
    expect(frameSrcFor('http://game.example/play', frame, '1')).toBeNull();
    expect(frameSrcFor('https://me:pw@game.example/play', frame, '1')).toBeNull();
    expect(frameSrcFor('javascript:alert(1)', frame, '1')).toBeNull();
    expect(frameSrcFor('data:text/html,hi', frame, '1')).toBeNull();
    expect(frameSrcFor(undefined, frame, '1')).toBeNull();
    // Developing on this machine: another loopback host is a different origin.
    expect(frameSrcFor('http://127.0.0.1:4180/activity', frame, '1')?.origin).toBe('http://127.0.0.1:4180');
  });

  it('never lets the frame navigate the top window or open modals', () => {
    expect(ACTIVITY_SANDBOX.split(' ')).not.toContain('allow-top-navigation');
    expect(ACTIVITY_SANDBOX.split(' ')).not.toContain('allow-modals');
  });
});
