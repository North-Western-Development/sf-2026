import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { createServer, type Server, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { RichPresence, RichPresenceError } from '../../packages/rich-presence/src/index.js';

/** Stands in for the desktop app's RPC server (apps/desktop/src-tauri/src/activity.rs). */
function fakeDesktop(port: number, readyDelay = 0) {
  const received: any[] = [];
  const urls: string[] = [];
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', async (ws, req) => {
    urls.push(req.url ?? '');
    if (readyDelay) await new Promise((r) => setTimeout(r, readyDelay));
    ws.send(JSON.stringify({ evt: 'READY', v: 1 }));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      received.push(msg);
      const ok = msg.cmd === 'SET_ACTIVITY' || msg.cmd === 'CLEAR_ACTIVITY';
      ws.send(JSON.stringify(ok ? { nonce: msg.nonce, ok: true } : { nonce: msg.nonce, ok: false, error: 'Unknown command' }));
    });
  });
  const close = () =>
    new Promise<void>((r) => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => r());
    });
  return { wss, received, urls, close };
}

describe('Rich Presence SDK', () => {
  let cleanup: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fn of cleanup) await fn();
    cleanup = [];
  });

  it('finds the desktop app on the first port that answers and sends the activity', async () => {
    const desktop = fakeDesktop(16475);
    cleanup.push(desktop.close);
    const presence = new RichPresence({ clientId: '1234567890', ports: [16473, 16474, 16475], reconnect: false });
    cleanup.push(() => presence.close());
    await presence.connect();
    expect(presence.connected).toBe(true);
    expect(desktop.urls[0]).toBe('/?v=1&client_id=1234567890');

    await presence.setActivity({ details: 'Competitive · Mirage', party: { size: 2, max: 5 } });
    await presence.clearActivity();
    expect(desktop.received.map((m) => m.cmd)).toEqual(['SET_ACTIVITY', 'CLEAR_ACTIVITY']);
    expect(desktop.received[0].args.activity.details).toBe('Competitive · Mirage');
  });

  it('says so when the desktop app is not running', async () => {
    const presence = new RichPresence({ clientId: '1234567890', ports: [16480], reconnect: false });
    await expect(presence.connect()).rejects.toThrow(RichPresenceError);
  });

  it('sends the activity again after the desktop app restarts', async () => {
    let desktop = fakeDesktop(16476);
    const presence = new RichPresence({ clientId: '1234567890', ports: [16476] });
    cleanup.push(() => presence.close());
    await presence.connect();
    await presence.setActivity({ state: 'In the lobby' });

    const gone = new Promise<void>((r) => presence.on('disconnected', r));
    await desktop.close();
    await gone;

    desktop = fakeDesktop(16476);
    cleanup.push(desktop.close);
    const back = new Promise<void>((r) => presence.on('ready', r));
    // Reconnecting waits 15s; jump the queue for the test.
    await (presence as any).open();
    await back;
    await expect.poll(() => desktop.received.map((m) => m.args?.activity?.state)).toEqual(['In the lobby']);
  });

  it('tries every port at once, and the first in the list that answers wins', async () => {
    const later = fakeDesktop(16481);
    const first = fakeDesktop(16483);
    cleanup.push(later.close, first.close);
    const presence = new RichPresence({ clientId: '1234567890', ports: [16484, 16485, 16486, 16487, 16483, 16481], reconnect: false });
    cleanup.push(() => presence.close());
    const started = Date.now();
    await presence.connect();
    // Four refused ports in turn would take about 8 s on Windows.
    expect(Date.now() - started).toBeLessThan(4000);
    await presence.setActivity({ state: 'First port' });
    expect(later.received).toHaveLength(0);
    expect(first.received.map((m) => m.args?.activity?.state)).toEqual(['First port']);
  });

  it('a later port failing while an earlier one is still answering does not crash the process', async () => {
    // Found against the real desktop app: 6474 refused before 6473 said READY.
    const desktop = fakeDesktop(16488, 300);
    cleanup.push(desktop.close);
    const presence = new RichPresence({ clientId: '1234567890', ports: [16488, 16489, 16490], reconnect: false });
    cleanup.push(() => presence.close());
    await presence.connect();
    expect(presence.connected).toBe(true);
  });

  it('refuses a client id that is not an application id', () => {
    expect(() => new RichPresence({ clientId: 'my-game' })).toThrow(RichPresenceError);
  });
});

/**
 * A desktop app stand-in that speaks raw RFC 6455 over TCP, so the tests see each client frame's
 * header length next to its payload bytes instead of what a WebSocket library reassembled.
 */
interface RawFrame {
  opcode: number;
  announced: number; // payload length from the frame header
  payload: Buffer; // exactly `announced` bytes, unmasked
}

function rawDesktop(port: number) {
  const frames: RawFrame[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const send = (opcode: number, data: Buffer) => {
      const head =
        data.length < 126 ? Buffer.from([0x80 | opcode, data.length]) : Buffer.from([0x80 | opcode, 126, data.length >> 8, data.length & 0xff]);
      socket.write(Buffer.concat([head, data]));
    };
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('latin1');
        buffer = buffer.subarray(end + 4);
        const key = /\r\nsec-websocket-key:\s*(\S+)/i.exec(head)?.[1] ?? '';
        const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        upgraded = true;
        send(0x1, Buffer.from(JSON.stringify({ evt: 'READY', v: 1 })));
      }
      for (;;) {
        if (buffer.length < 2) return;
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let length = buffer[1] & 0x7f;
        let at = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          at = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          at = 10;
        }
        const mask = masked ? buffer.subarray(at, at + 4) : Buffer.alloc(4);
        if (masked) at += 4;
        if (buffer.length < at + length) return;
        const payload = Buffer.from(buffer.subarray(at, at + length));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buffer = buffer.subarray(at + length);
        frames.push({ opcode, announced: length, payload });
        if (opcode === 0x8) return void socket.end();
        if (opcode !== 0x1) continue;
        // Reply ok to anything with a nonce, so setActivity resolves; strictness is checked by the test.
        const nonce = /"nonce":"(\d+)"/.exec(payload.toString('latin1'))?.[1];
        if (nonce) send(0x1, Buffer.from(JSON.stringify({ nonce, ok: true })));
      }
    });
  });
  const listening = new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  const close = () =>
    new Promise<void>((r) => {
      for (const s of sockets) s.destroy();
      server.close(() => r());
    });
  return { frames, listening, close, texts: () => frames.filter((f) => f.opcode === 0x1) };
}

/**
 * Strict JSON for a frame, as the desktop app (serde_json) reads it: fatal UTF-8 decoding, no raw
 * control characters (JSON.parse already refuses those), and every string well-formed UTF-16, since
 * serde_json rejects a lone \ud800-style escape that JSON.parse would accept.
 */
function strictParse(bytes: Buffer): any {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (!(v as any).isWellFormed()) throw new Error(`lone surrogate at ${path}`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) {
        if (!(k as any).isWellFormed()) throw new Error(`lone surrogate in key at ${path}`);
        walk(item, `${path}.${k}`);
      }
    }
  };
  walk(value, '$');
  return value;
}

/** Top-level keys in the order they appear in the raw text of one object, duplicates included. */
function rawKeys(objectText: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < objectText.length; i++) {
    const c = objectText[i];
    if (c === '"') {
      let j = i + 1;
      while (objectText[j] !== '"') j += objectText[j] === '\\' ? 2 : 1;
      let k = j + 1;
      while (objectText[k] === ' ') k++;
      if (depth === 1 && objectText[k] === ':') keys.push(JSON.parse(objectText.slice(i, j + 1)));
      i = j;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return keys;
}

const CONTROL = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).join('') + '\u007f"\\/  ';
const HOSTILE: Array<[string, string]> = [
  ['double quote', '"'],
  ['backslash', '\\'],
  ['escaped quote', '\\"'],
  ['quote then backslash', '"\\'],
  ['mixed', 'a"b\\c"d'],
  ['newlines, CR and tab', 'line\nbreak\r\ncarriage\ttab'],
  ['every control character U+0000-U+001F, DEL, U+2028/2029', CONTROL],
  ['NUL', '\u0000'],
  ['NUL inside', 'nul\u0000inside'],
  ['U+2028 / U+2029', '  '],
  ['script tags', '</script><script>alert(1)</script>'],
  ['key injection', '","type":0,"x":"'],
  ['command injection', '"},"cmd":"CLEAR_ACTIVITY","z":{"a":"'],
  ['pre-escaped injection', '\\",\\"type\\":0,\\"x\\":\\"'],
  ['button injection', '"]}],"buttons":[{"label":"x","url":"javascript:alert(1)"}],"y":"'],
  ['astral and BMP characters', '\u{1F3AF} emoji é 中 \u{10FFFF}'],
  ['very long', 'x'.repeat(70_000) + '"' + '\\'.repeat(70_000)],
];
const LONE_SURROGATES: Array<[string, string, string]> = [
  ['lone high', 'lone high \ud800 here', 'lone high � here'],
  ['lone low', 'lone low \udc00 here', 'lone low � here'],
  ['reversed pair', 'reversed \udc00\ud800 pair', 'reversed �� pair'],
  ['ends with a high surrogate', 'ends with high \ud83c', 'ends with high �'],
  ['pair then lone', 'pair then lone \u{1F3AF}\ud83c', 'pair then lone \u{1F3AF}�'],
];

const ACTIVITY_KEYS = ['type', 'details', 'state', 'largeImage', 'largeText', 'smallImage', 'smallText', 'buttons'];

function hostileActivity(s: string) {
  return {
    type: 'playing' as const,
    details: s,
    state: s,
    largeImage: s,
    largeText: s,
    smallImage: s,
    smallText: s,
    buttons: [
      { label: s, url: s },
      { label: s + '2', url: s + '3' },
    ],
  };
}

function expectHostileFrame(frame: RawFrame, want: string) {
  // The header length must be the UTF-8 byte length, not a UTF-16 count.
  expect(frame.opcode).toBe(0x1);
  expect(frame.announced).toBe(frame.payload.length);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(frame.payload);
  expect(Buffer.byteLength(text, 'utf8')).toBe(frame.announced);
  const msg = strictParse(frame.payload);
  expect(rawKeys(text)).toEqual(['cmd', 'nonce', 'args']);
  expect(msg.cmd).toBe('SET_ACTIVITY');
  expect(Object.keys(msg.args)).toEqual(['activity']);
  const activity = msg.args.activity;
  expect(Object.keys(activity)).toEqual(ACTIVITY_KEYS);
  expect(activity.type).toBe('playing');
  for (const key of ['details', 'state', 'largeImage', 'largeText', 'smallImage', 'smallText']) expect(activity[key]).toBe(want);
  expect(activity.buttons).toEqual([
    { label: want, url: want },
    { label: want + '2', url: want + '3' },
  ]);
  for (const button of activity.buttons) expect(Object.keys(button)).toEqual(['label', 'url']);
}

describe('Rich Presence SDK: hostile strings', () => {
  let cleanup: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fn of cleanup) await fn();
    cleanup = [];
  });
  let nextPort = 16500;

  async function connected() {
    const port = nextPort++;
    const desktop = rawDesktop(port);
    await desktop.listening;
    cleanup.push(desktop.close);
    const presence = new RichPresence({ clientId: '1234567890', ports: [port], reconnect: false });
    cleanup.push(() => presence.close());
    await presence.connect();
    return { desktop, presence };
  }

  it('the strict checks catch what they should', () => {
    expect(() => strictParse(Buffer.from('{"a":"\\ud800"}'))).toThrow();
    expect(() => strictParse(Buffer.from('{"a":"\u0001"}'))).toThrow();
    expect(() => strictParse(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))).toThrow();
    expect(strictParse(Buffer.from('{"a":"\\ud83c\\udfaf\\u2028"}')).a).toBe('\u{1F3AF} ');
    expect(rawKeys('{"a":1,"a":2,"b":{"c":3}}')).toEqual(['a', 'a', 'b']);
  });

  it.each(HOSTILE)('%s: strict JSON that round-trips, with no injected keys', async (_name, s) => {
    const { desktop, presence } = await connected();
    await presence.setActivity(hostileActivity(s));
    const frames = desktop.texts();
    expect(frames).toHaveLength(1);
    expectHostileFrame(frames[0], s);
  });

  it('frame header lengths match the UTF-8 byte length for multi-byte payloads', async () => {
    const { desktop, presence } = await connected();
    const strings = [
      '\u{1F3AF} é', // 3 characters, 4 + 3 + 2 bytes
      '\u0001'.repeat(20) + '\u{1F3AF}', // short in UTF-16, 6x longer once escaped
      '中'.repeat(40), // 7-bit by char count, 16-bit by bytes
      '\u{1F3AF}'.repeat(9000), // 16-bit by char count per field, 64-bit by bytes
    ];
    for (const s of strings) await presence.setActivity(hostileActivity(s));
    const frames = desktop.texts();
    expect(frames).toHaveLength(strings.length);
    frames.forEach((frame, i) => expectHostileFrame(frame, strings[i]));
    expect(frames[3].announced).toBeGreaterThan(0xffff);
  });

  // BUG (robustness, not security): JSON.stringify writes a lone surrogate as a \udXXX escape. That
  // is valid JSON grammar, but the desktop app parses with serde_json, which refuses lone surrogate
  // escapes and answers {"ok":false,"error":"Not JSON"} without the nonce, so setActivity() hangs
  // until its 10 s timeout and the activity never shows. The C# and C++ SDKs replace lone
  // surrogates with U+FFFD. Fix: in setActivity, map every string field through s.toWellFormed().
  // it.fails keeps the suite green and turns red once the bug is fixed (then make these plain it.each).
  it.each(LONE_SURROGATES)('%s: lone surrogates are sent as U+FFFD (strict UTF-8 JSON)', async (_name, s, sanitized) => {
    const { desktop, presence } = await connected();
    await presence.setActivity(hostileActivity(s));
    const frames = desktop.texts();
    expect(frames).toHaveLength(1);
    expectHostileFrame(frames[0], sanitized);
  });

  it.each([
    '1 HTTP/1.1\r\nOrigin: https://evil.example\r\nX: y',
    '1\r\n',
    '1\n',
    '1&client_id=2',
    '1%0d%0a',
    '1/../2',
    '1#x',
    '１２',
    '١٢',
    '12 ',
    ' 12',
    '-12',
    '+12',
    '1.5',
    '"1"',
    '1\u00002',
    '","type":0,"x":"',
    '12345678901234567890',
    '0123',
  ])('refuses the hostile client id %j', (clientId) => {
    expect(() => new RichPresence({ clientId })).toThrow(RichPresenceError);
  });
});
