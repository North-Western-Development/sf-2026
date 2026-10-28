/**
 * @subspace/activity-sdk: build Activities that people open together inside a Subspace Frequency
 * comm-link. Your page runs in a sandboxed iframe on your own https origin; this SDK is the only
 * way it talks to Subspace (window.postMessage, origin- and nonce-checked both ways).
 *
 *   const sdk = new ActivitySdk({ clientId: 'YOUR_APPLICATION_ID', allowedOrigins: ['https://subspace.click'] });
 *   await sdk.ready();
 *   sdk.user, sdk.instance, sdk.participants
 *   sdk.on('participants', (people) => ...);
 *   const { code } = await sdk.authorize({ scopes: ['identify'] }); // exchange it on YOUR backend
 *
 * Never trust `sdk.user` for anything that matters: any page can frame yours and claim to be
 * Subspace. Who someone really is comes from exchanging an `authorize()` code with your client
 * secret, server-side.
 */

export const PROTOCOL_VERSION = 1;

/** Commands the SDK sends. Subspace refuses anything else. */
export type Command = 'HANDSHAKE' | 'AUTHORIZE' | 'OPEN_EXTERNAL_LINK' | 'BROADCAST';

/** A participant's public profile. `avatarUrl` is absolute (on the Subspace instance) or null. */
export interface ActivityUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ActivityInstance {
  /** This running instance: use it as your multiplayer room key. Everyone in it gets the same id. */
  id: string;
  /** The comm-link (voice channel) and beacon (server) it runs in. */
  channelId: string;
  beaconId: string;
  /** Who started it, or took over when they left. */
  hostId: string;
}

export interface ActivityMessage {
  /** The participant who broadcast it. */
  from: string;
  payload: unknown;
}

export interface SdkEvents {
  /** Everyone in the instance, whenever someone joins or leaves. */
  participants: (participants: ActivityUser[], hostId: string) => void;
  /** A broadcast() from another participant. */
  message: (message: ActivityMessage) => void;
}

/** The parts of `window` the SDK uses (pass a fake one in tests). */
export interface WindowLike {
  parent: unknown;
  location: { hash: string; ancestorOrigins?: { length: number; [i: number]: string } };
  /** document.referrer: set by the browser, so a page framing the activity cannot forge it. */
  document?: { referrer: string };
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  crypto?: { getRandomValues<T extends ArrayBufferView | null>(a: T): T };
}

export interface ActivitySdkOptions {
  /** Your application's ID (Client ID in Developer Applications). */
  clientId: string;
  /**
   * The Subspace instances allowed to host your activity, e.g. ['https://subspace.click']. Strongly
   * recommended: without it the SDK talks to whichever origin the frame's URL names (and, where the
   * browser can tell, really is the parent). Also set `Content-Security-Policy: frame-ancestors` on
   * your page to the same list.
   */
  allowedOrigins?: string[];
  /** How long ready() waits for Subspace, in ms (default 10 000). */
  timeoutMs?: number;
  /** For tests: the window to use. */
  window?: WindowLike;
}

export class ActivitySdkError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ActivitySdkError';
  }
}

interface Pending {
  resolve: (data: any) => void;
  reject: (err: ActivitySdkError) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** The handshake values Subspace puts in the frame's URL fragment. */
export function readLaunchParams(hash: string): { frameId: string | null; parentOrigin: string | null; instanceId: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const frameId = params.get('frame_id');
  const origin = params.get('parent_origin');
  let parentOrigin: string | null = null;
  try {
    // Only a bare origin (scheme://host[:port]) counts.
    if (origin && new URL(origin).origin === origin) parentOrigin = origin;
  } catch {
    parentOrigin = null;
  }
  return { frameId: frameId && /^[0-9a-f]{32}$/.test(frameId) ? frameId : null, parentOrigin, instanceId: params.get('instance_id') };
}

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

function randomNonce(win: WindowLike): string {
  const bytes = new Uint8Array(16);
  const c = win.crypto ?? (globalThis as any).crypto;
  if (!c?.getRandomValues) throw new ActivitySdkError('NO_CRYPTO', 'crypto.getRandomValues is not available');
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ActivitySdk {
  readonly clientId: string;
  /** This frame's handshake id, from the URL fragment. */
  readonly frameId: string | null;
  /** The Subspace origin this frame answers to, once checked. */
  readonly parentOrigin: string | null;

  instance: ActivityInstance | null = null;
  user: ActivityUser | null = null;
  participants: ActivityUser[] = [];
  application: { id: string; name: string } | null = null;

  private win: WindowLike;
  private timeoutMs: number;
  private pending = new Map<string, Pending>();
  private listeners: { [K in keyof SdkEvents]: Set<SdkEvents[K]> } = { participants: new Set(), message: new Set() };
  private readyPromise: Promise<void> | null = null;
  private connected = false;
  private setupError: ActivitySdkError | null = null;
  private onMessage = (e: MessageEvent) => this.receive(e);

  constructor(options: ActivitySdkOptions) {
    if (!options?.clientId || !/^[1-9][0-9]{0,18}$/.test(options.clientId)) throw new ActivitySdkError('INVALID_CLIENT_ID', 'clientId must be your application ID');
    this.clientId = options.clientId;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.win = options.window ?? (globalThis as unknown as WindowLike);
    const { frameId, parentOrigin } = readLaunchParams(this.win.location?.hash ?? '');
    this.frameId = frameId;
    let origin = parentOrigin;
    if (!frameId || !origin) {
      this.setupError = new ActivitySdkError('NOT_LAUNCHED', 'Open this page from a Subspace comm-link (no launch parameters in the URL)');
      origin = null;
    } else if (this.win.parent === this.win || !this.win.parent) {
      this.setupError = new ActivitySdkError('NOT_FRAMED', 'This page is not inside Subspace');
      origin = null;
    } else if (options.allowedOrigins && !options.allowedOrigins.includes(origin)) {
      this.setupError = new ActivitySdkError('ORIGIN_NOT_ALLOWED', `${origin} is not in allowedOrigins`);
      origin = null;
    } else {
      // Who really framed us, as the browser says: ancestorOrigins (Chromium, Safari), else the
      // referrer Subspace sends (Firefox). A page that frames the activity can claim any
      // parent_origin, but cannot forge either of these; it can only hide the referrer.
      const ancestors = this.win.location.ancestorOrigins;
      const framer = ancestors && ancestors.length > 0 ? ancestors[0] : originOf(this.win.document?.referrer);
      if (framer ? framer !== origin : !options.allowedOrigins) {
        this.setupError = framer
          ? new ActivitySdkError('ORIGIN_MISMATCH', 'The page framing this activity is not the one it claims to be')
          : new ActivitySdkError('ORIGIN_UNVERIFIED', 'This browser does not say which page framed the activity: set allowedOrigins');
        origin = null;
      }
    }
    this.parentOrigin = origin;
    if (origin) this.win.addEventListener('message', this.onMessage);
  }

  /** Connect to Subspace: resolves once instance, user and participants are known. */
  ready(): Promise<void> {
    if (this.setupError) return Promise.reject(this.setupError);
    this.readyPromise ??= this.request('HANDSHAKE', { clientId: this.clientId, v: PROTOCOL_VERSION }, this.timeoutMs).then((d: any) => {
      this.instance = d.instance;
      this.user = d.user;
      this.participants = d.participants ?? [];
      this.application = d.application ?? null;
      this.connected = true;
    });
    return this.readyPromise;
  }

  on<K extends keyof SdkEvents>(event: K, fn: SdkEvents[K]): () => void {
    this.listeners[event].add(fn as any);
    return () => this.off(event, fn);
  }

  off<K extends keyof SdkEvents>(event: K, fn: SdkEvents[K]) {
    this.listeners[event].delete(fn as any);
  }

  /**
   * Ask the person to let your app know who they are (OAuth2). Subspace shows its own consent
   * prompt unless they already granted these scopes. Resolves with an authorization code that
   * your backend exchanges at POST /api/v1/oauth2/token with your client secret and no
   * redirect_uri. The code is single use and lasts ten minutes.
   */
  authorize(options: { scopes: Array<'identify' | 'email' | 'beacons'> }): Promise<{ code: string; scopes: string[] }> {
    return this.command('AUTHORIZE', { scopes: options.scopes }, 0);
  }

  /** Open a link in a new tab, after Subspace's "Leaving Subspace" check. */
  openExternalLink(url: string): Promise<{ opened: boolean }> {
    return this.command('OPEN_EXTERNAL_LINK', { url });
  }

  /**
   * Send JSON (at most 4 KB) to everyone else in this instance, relayed by Subspace: handy for
   * small shared state. Nothing is stored; late joiners do not get earlier messages. For anything
   * bigger or authoritative, sync through your own backend keyed by `instance.id`.
   */
  broadcast(payload: unknown): Promise<void> {
    return this.command('BROADCAST', { payload });
  }

  /** Stop listening (call when your page tears down). Pending calls are rejected. */
  destroy() {
    this.win.removeEventListener('message', this.onMessage);
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new ActivitySdkError('DESTROYED', 'The SDK was destroyed'));
    }
    this.pending.clear();
  }

  private async command(cmd: Command, args: Record<string, unknown>, timeoutMs = this.timeoutMs) {
    if (!this.connected) await this.ready();
    return this.request(cmd, args, timeoutMs);
  }

  private request(cmd: Command, args: Record<string, unknown>, timeoutMs: number): Promise<any> {
    if (this.setupError || !this.parentOrigin) return Promise.reject(this.setupError ?? new ActivitySdkError('NOT_LAUNCHED', 'Not inside Subspace'));
    const nonce = randomNonce(this.win);
    return new Promise((resolve, reject) => {
      const p: Pending = { resolve, reject };
      if (timeoutMs > 0) {
        p.timer = setTimeout(() => {
          this.pending.delete(nonce);
          reject(new ActivitySdkError('TIMEOUT', `${cmd} got no answer from Subspace`));
        }, timeoutMs);
      }
      this.pending.set(nonce, p);
      // targetOrigin, never '*': if anyone else is our parent, the browser does not deliver it.
      (this.win.parent as Window).postMessage({ subspace: 'activity', v: PROTOCOL_VERSION, frameId: this.frameId, nonce, cmd, args }, this.parentOrigin!);
    });
  }

  /** Only our parent, from the checked origin, with our frame id, is listened to. */
  private receive(e: MessageEvent) {
    if (e.source !== this.win.parent || e.origin !== this.parentOrigin) return;
    const d = e.data as any;
    if (!d || typeof d !== 'object' || d.subspace !== 'host' || d.v !== PROTOCOL_VERSION || d.frameId !== this.frameId) return;
    if (typeof d.nonce === 'string') {
      const p = this.pending.get(d.nonce);
      if (!p) return;
      this.pending.delete(d.nonce);
      if (p.timer) clearTimeout(p.timer);
      if (d.ok) p.resolve(d.data);
      else p.reject(new ActivitySdkError(String(d.error?.code ?? 'ERROR'), String(d.error?.message ?? 'Subspace refused that')));
      return;
    }
    // Events count only after the handshake.
    if (!this.connected) return;
    if (d.event === 'participants' && Array.isArray(d.data?.participants)) {
      this.participants = d.data.participants;
      if (this.instance && typeof d.data.hostId === 'string') this.instance = { ...this.instance, hostId: d.data.hostId };
      this.listeners.participants.forEach((fn) => fn(this.participants, this.instance?.hostId ?? ''));
    } else if (d.event === 'message' && d.data && typeof d.data.from === 'string') {
      this.listeners.message.forEach((fn) => fn({ from: d.data.from, payload: d.data.payload }));
    }
  }
}

export default ActivitySdk;
