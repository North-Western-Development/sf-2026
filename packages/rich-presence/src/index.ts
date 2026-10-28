/**
 * Subspace Frequency Rich Presence: show what a player is doing in your game ("Competitive ·
 * Mirage", "In a party of 3 of 5") on their Subspace profile, next to their name and in member
 * lists. It talks to the Subspace desktop app on the same computer over its local RPC server;
 * the desktop app shares it with the player's friends as their Activity Privacy setting allows.
 *
 *   const presence = new RichPresence({ clientId: '1234567890' });
 *   await presence.connect();
 *   await presence.setActivity({ details: 'Competitive · Mirage', state: 'In a match', startedAt: Date.now() });
 *
 * `clientId` is your application's id from User Settings › Developer Applications. The activity
 * shows your application's name and icon; it ends when you call clearActivity() or close().
 * Needs a global WebSocket: Node 22 or later, Deno, Bun or Electron.
 */

export type ActivityType = 'playing' | 'streaming' | 'listening' | 'watching' | 'competing';

export interface ActivityButton {
  /** Up to 32 characters. */
  label: string;
  /** An https:// link. */
  url: string;
}

export interface Activity {
  /** Defaults to 'playing'. */
  type?: ActivityType;
  /** First line under your application's name (up to 128 characters). */
  details?: string;
  /** Second line (up to 128 characters). */
  state?: string;
  /** Unix time in ms: shows "for 12m". */
  startedAt?: number;
  /** Unix time in ms: shows a countdown instead ("3:12 left"). */
  endsAt?: number;
  /** https:// image URLs. Without a large image your application's icon is shown. */
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  /** Shown after the state: "(2 of 4)". */
  party?: { size: number; max: number };
  /** Up to two link buttons. */
  buttons?: ActivityButton[];
}

export interface RichPresenceOptions {
  /** Your Subspace application id. */
  clientId: string;
  /** Keep trying to (re)connect while the desktop app is closed, then send the activity again. Default true. */
  reconnect?: boolean;
  /** Ports to try; the desktop app listens on the first free one of 6473-6482. */
  ports?: number[];
  /** Host of the desktop app's RPC server. Always this computer. */
  host?: '127.0.0.1' | 'localhost';
}

export const RPC_PORTS = Array.from({ length: 10 }, (_, i) => 6473 + i);
const RECONNECT_MS = 15_000;
const REPLY_TIMEOUT_MS = 10_000;

type Listener = () => void;

export class RichPresenceError extends Error {}

/**
 * Strings as well-formed UTF-16: a lone surrogate becomes U+FFFD. The desktop app reads strict
 * UTF-8 JSON and would refuse the whole update otherwise.
 */
function wellFormed<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�') as T;
  if (Array.isArray(v)) return v.map(wellFormed) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wellFormed(x)])) as T;
  return v;
}

export class RichPresence {
  private readonly clientId: string;
  private readonly ports: number[];
  private readonly host: string;
  private readonly reconnect: boolean;
  private socket: WebSocket | null = null;
  private activity: Activity | null = null;
  private nonce = 0;
  private pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private listeners = { ready: new Set<Listener>(), disconnected: new Set<Listener>() };

  constructor(options: RichPresenceOptions) {
    if (!/^[1-9][0-9]{0,18}$/.test(options.clientId ?? '')) throw new RichPresenceError('clientId must be your Subspace application id');
    this.clientId = options.clientId;
    this.ports = options.ports ?? RPC_PORTS;
    this.host = options.host ?? '127.0.0.1';
    this.reconnect = options.reconnect ?? true;
  }

  /** Whether the desktop app is connected right now. */
  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** 'ready' when connected to the desktop app, 'disconnected' when it goes away. Returns an unsubscribe. */
  on(event: 'ready' | 'disconnected', fn: Listener) {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  /**
   * Find the desktop app. Rejects when it is not running, unless `reconnect` is on: then it keeps
   * looking in the background and resolves now, and setActivity() is sent once it is found.
   */
  async connect(): Promise<void> {
    this.closed = false;
    try {
      await this.open();
    } catch (err) {
      if (!this.reconnect) throw err;
      this.scheduleRetry();
    }
  }

  /** Show (or update) the activity. Sent again on every reconnect. */
  async setActivity(activity: Activity): Promise<void> {
    this.activity = wellFormed({ ...activity });
    if (this.connected) await this.request('SET_ACTIVITY', { activity: this.activity });
  }

  async clearActivity(): Promise<void> {
    this.activity = null;
    if (this.connected) await this.request('CLEAR_ACTIVITY');
  }

  /** Disconnect; the activity ends with it. */
  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    // Commands still waiting for an answer end now, not after their timeout.
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new RichPresenceError('Closed'));
      this.pending.delete(id);
    }
    this.socket?.close();
    this.socket = null;
  }

  private async open() {
    let lastError: unknown = null;
    // Every port at once: on Windows a refused connection takes about 2 s, so trying them in turn
    // takes 20 s. The first port in the list that answers wins; the others are hung up on.
    const attempts = this.ports.map((port) => this.tryPort(port));
    // A later port can fail while an earlier one is still being waited on: handled here, or
    // Node would stop the process on an unhandled rejection.
    for (const attempt of attempts) attempt.catch(() => {});
    for (const [i, attempt] of attempts.entries()) {
      try {
        const ws = await attempt;
        for (const rest of attempts.slice(i + 1)) rest.then((other) => other.close(), () => {});
        if (this.closed) {
          ws.close();
          return;
        }
        this.socket = ws;
        this.listeners.ready.forEach((fn) => fn());
        if (this.activity) await this.request('SET_ACTIVITY', { activity: this.activity }).catch(() => {});
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw new RichPresenceError(`The Subspace desktop app is not running (${(lastError as Error)?.message ?? 'no answer'})`);
  }

  private tryPort(port: number) {
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.host}:${port}/?v=1&client_id=${this.clientId}`);
      let ready = false;
      // Something else on the port that never says READY is not the desktop app.
      const giveUp = setTimeout(() => {
        if (ready) return;
        ws.close();
        reject(new Error(`port ${port}`));
      }, 3000);
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (!ready && msg.evt === 'READY') {
          ready = true;
          clearTimeout(giveUp);
          return resolve(ws);
        }
        const waiter = msg.nonce != null ? this.pending.get(String(msg.nonce)) : undefined;
        if (!waiter) return;
        this.pending.delete(String(msg.nonce));
        clearTimeout(waiter.timer);
        if (msg.ok) waiter.resolve();
        else waiter.reject(new RichPresenceError(msg.error ?? 'Refused'));
      };
      ws.onerror = () => {
        if (!ready) reject(new Error(`port ${port}`));
      };
      ws.onclose = () => {
        if (!ready) return reject(new Error(`port ${port}`));
        if (this.socket !== ws) return;
        this.socket = null;
        for (const [id, waiter] of this.pending) {
          clearTimeout(waiter.timer);
          waiter.reject(new RichPresenceError('Disconnected from the Subspace desktop app'));
          this.pending.delete(id);
        }
        this.listeners.disconnected.forEach((fn) => fn());
        if (this.reconnect && !this.closed) this.scheduleRetry();
      };
    });
  }

  private scheduleRetry() {
    if (this.retry || this.closed) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open().catch(() => this.scheduleRetry());
    }, RECONNECT_MS);
    // Never keep a process alive just to look for the desktop app.
    (this.retry as { unref?: () => void }).unref?.();
  }

  private request(cmd: string, args?: Record<string, unknown>) {
    const socket = this.socket;
    if (!socket) return Promise.reject(new RichPresenceError('Not connected'));
    const nonce = String(++this.nonce);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new RichPresenceError(`${cmd} timed out`));
      }, REPLY_TIMEOUT_MS);
      this.pending.set(nonce, { resolve, reject, timer });
      socket.send(JSON.stringify({ cmd, nonce, ...(args ? { args } : {}) }));
    });
  }
}
