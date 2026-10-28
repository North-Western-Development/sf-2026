import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Subspace Frequency bot SDK.
 *
 *   const bot = new SubspaceBot({ token: process.env.BOT_TOKEN!, baseUrl: 'https://subspace.click' });
 *   await bot.registerCommands([{ name: 'ping', description: 'Check the bot is alive' }]);
 *   bot.on('interaction', (i) => i.reply({ content: 'Pong!' }));
 *   bot.on('message', (m) => { if (m.content === '!hello') bot.send(m.channelType, m.channelId, 'Hi!'); });
 *   await bot.connect();
 *
 * Or receive interactions over HTTP instead of the gateway: set the application's Interactions
 * Endpoint URL, check each request with `verifyInteraction`, and answer in the response body.
 *
 * Runs on Node 18+, Deno and Bun. The gateway uses the runtime's built-in WebSocket (Node 22+,
 * Deno, Bun) and falls back to the `ws` package only where there is none (Node 18 and 20).
 */

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number | string;
  timestamp?: string;
  author?: { name: string; url?: string };
  footer?: { text: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface CommandOption {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'relay' | 'clearance';
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
}

export interface CommandDefinition {
  name: string;
  description: string;
  options?: CommandOption[];
  /** A permission bitfield (decimal string) members need to see and use it. */
  defaultMemberPermissions?: string | null;
}

export interface Reply {
  content?: string;
  embeds?: Embed[];
  /** Only the person who used the command sees it. */
  ephemeral?: boolean;
}

export interface Message {
  id: string;
  channelType: 'relay' | 'thread' | 'link' | 'mesh';
  channelId: string;
  author: { id: string; username: string; displayName?: string | null; botKind?: string | null };
  content: string;
  mentions: string[];
  embeds: unknown[];
  createdAt: string;
  [key: string]: unknown;
}

export interface InteractionPayload {
  type: 2;
  id: string;
  token: string;
  applicationId: string;
  beaconId: string;
  channel: { type: 'relay' | 'thread'; id: string };
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  memberPermissions: string;
  data: { id: string; name: string; options: Array<{ name: string; type: string; value: unknown }> };
}

export class SubspaceApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** The parts of a WebSocket the SDK uses: the web-standard API, which `ws` implements too. */
interface GatewaySocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
}
type GatewaySocketCtor = new (url: string) => GatewaySocket;
const OPEN = 1;

let wsPackage: Promise<GatewaySocketCtor> | null = null;
/** The global WebSocket when the runtime has one, else the `ws` package (loaded only then). */
function loadWebSocket(): Promise<GatewaySocketCtor> {
  const builtIn = (globalThis as { WebSocket?: GatewaySocketCtor }).WebSocket;
  if (builtIn) return Promise.resolve(builtIn);
  // A non-literal specifier keeps Deno and bundlers from resolving `ws` where it is never needed.
  const specifier = 'ws';
  return (wsPackage ??= import(specifier).then((m: { WebSocket?: GatewaySocketCtor; default?: GatewaySocketCtor }) => (m.WebSocket ?? m.default)!));
}

const textOf = (data: unknown): string =>
  typeof data === 'string' ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array));

/** A slash command someone used: read its options, then answer within 3 seconds (or defer). */
export class Interaction {
  constructor(private bot: SubspaceBot, public readonly raw: InteractionPayload) {}
  get id() {
    return this.raw.id;
  }
  get commandName() {
    return this.raw.data.name;
  }
  get user() {
    return this.raw.user;
  }
  get channel() {
    return this.raw.channel;
  }
  get beaconId() {
    return this.raw.beaconId;
  }
  /** An option's value, or undefined when it was not given. */
  option<T = unknown>(name: string): T | undefined {
    return this.raw.data.options.find((o) => o.name === name)?.value as T | undefined;
  }
  private path(suffix: string) {
    return `/interactions/${this.raw.id}/${this.raw.token}/${suffix}`;
  }
  /** Answer now. */
  reply(reply: Reply | string) {
    return this.bot.rest('POST', this.path('callback'), { type: 4, data: typeof reply === 'string' ? { content: reply } : reply }, false);
  }
  /** "Thinking…": the answer follows with followUp (within 15 minutes). */
  defer(opts: { ephemeral?: boolean } = {}) {
    return this.bot.rest('POST', this.path('callback'), { type: 5, data: opts }, false);
  }
  followUp(reply: Reply | string) {
    return this.bot.rest('POST', this.path('followup'), typeof reply === 'string' ? { content: reply } : reply, false);
  }
  editReply(reply: Reply | string) {
    return this.bot.rest('PATCH', this.path('original'), typeof reply === 'string' ? { content: reply } : reply, false);
  }
}

export interface BotOptions {
  token: string;
  /** The instance, e.g. https://subspace.click. */
  baseUrl: string;
  /** The gateway's WebSocket URL; by default <baseUrl>/gateway. */
  gatewayUrl?: string;
}

export class SubspaceBot extends EventEmitter {
  private ws: GatewaySocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** Who the bot is, once connected or after `me()`. */
  user: { id: string; username: string; appId: string; beaconIds: string[] } | null = null;

  constructor(private opts: BotOptions) {
    super();
  }

  /** A REST call; `asBot` false for the interaction endpoints, where the URL's token is the credential. */
  async rest<T = any>(method: string, path: string, body?: unknown, asBot = true): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
      method,
      headers: { ...(asBot ? { authorization: `Bot ${this.opts.token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) {
      await res.body?.cancel();
      return undefined as T;
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new SubspaceApiError(data.error || res.statusText, res.status, data.code);
    return data as T;
  }

  async me() {
    const { bot } = await this.rest<{ bot: { id: string; username: string; appId: string; beaconIds: string[] } }>('GET', '/bots/@me');
    this.user = bot;
    return bot;
  }

  /** Post in a relay or thread the bot can see. */
  send(channelType: 'relay' | 'thread', channelId: string, message: string | { content?: string; replyToId?: string; embeds?: Embed[] }) {
    const body = typeof message === 'string' ? { content: message } : message;
    return this.rest<{ transmission: Message }>('POST', `/channels/${channelType}/${channelId}/transmissions`, body).then((r) => r.transmission);
  }
  edit(transmissionId: string, content: string) {
    return this.rest('PATCH', `/transmissions/${transmissionId}`, { content });
  }
  delete(transmissionId: string) {
    return this.rest('DELETE', `/transmissions/${transmissionId}`);
  }
  react(transmissionId: string, emoji: string) {
    return this.rest('PUT', `/transmissions/${transmissionId}/reactions/${encodeURIComponent(emoji)}/@me`);
  }

  /** Replace the bot's commands: everywhere, or in one beacon. */
  async registerCommands(commands: CommandDefinition[], beaconId?: string) {
    const appId = (this.user ?? (await this.me())).appId;
    const path = beaconId ? `/applications/${appId}/beacons/${beaconId}/commands` : `/applications/${appId}/commands`;
    return (await this.rest<{ commands: Array<CommandDefinition & { id: string }> }>('PUT', path, commands)).commands;
  }

  /** Connect to the gateway: emits 'ready', 'message', 'messageUpdate', 'messageDelete', 'interaction' and 'dispatch'. */
  async connect(): Promise<void> {
    if (!this.user) await this.me();
    this.closing = false;
    const url = this.opts.gatewayUrl ?? `${this.opts.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/gateway`;
    const WebSocketImpl = await loadWebSocket();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocketImpl(url);
      this.ws = ws;
      ws.addEventListener('message', (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(textOf(ev.data));
        } catch {
          return;
        }
        if (msg.op === 10) {
          const every = msg.d?.heartbeat_interval ?? 30_000;
          if (this.heartbeat) clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => ws.readyState === OPEN && ws.send(JSON.stringify({ op: 1 })), every);
          ws.send(JSON.stringify({ op: 2, d: { token: `Bot ${this.opts.token}` } }));
          return;
        }
        if (msg.op !== 0) return;
        const { t, d } = msg as { t: string; d: any };
        if (t === 'READY') {
          this.emit('ready', d);
          resolve();
        } else if (t === 'TRANSMISSION_CREATE' && d.transmission) {
          this.emit('message', { ...d.transmission, channelType: d.channelType, channelId: d.channelId } as Message);
        } else if (t === 'TRANSMISSION_UPDATE' && d.transmission) {
          this.emit('messageUpdate', d.transmission);
        } else if (t === 'TRANSMISSION_DELETE') {
          this.emit('messageDelete', d);
        } else if (t === 'INTERACTION_CREATE') {
          this.emit('interaction', new Interaction(this, d as InteractionPayload));
        }
        this.emit('dispatch', t, d);
      });
      ws.addEventListener('close', (ev) => {
        if (this.ws === ws) {
          if (this.heartbeat) clearInterval(this.heartbeat);
          this.heartbeat = null;
          this.ws = null;
        }
        this.emit('close', ev.code, String(ev.reason ?? ''));
        if (ev.code === 4003) reject(new SubspaceApiError('Invalid bot token', 401, 'INVALID_BOT_TOKEN'));
        // Reconnect unless we were asked to stop.
        // (A first connect still waiting for READY settles with the reconnect.)
        else if (!this.closing)
          this.retry = setTimeout(() => {
            this.retry = null;
            // disconnect() during the wait stops here.
            if (this.closing) return resolve();
            void this.connect().then(resolve, (err) => {
              if (this.listenerCount('error')) this.emit('error', err);
              reject(err);
            });
          }, 2000);
        else resolve();
      });
      // Emit only when someone listens (an unhandled 'error' event throws); the close that follows reconnects.
      ws.addEventListener('error', (ev) => {
        if (this.listenerCount('error')) this.emit('error', (ev as { error?: unknown })?.error ?? ev);
      });
    });
  }

  disconnect() {
    this.closing = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws?.close(1000);
  }
}

const SPKI_ED25519_PREFIX = '302a300506032b6570032100';
const isFresh = (signature: string, timestamp: string) =>
  !!signature && !!timestamp && /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;

function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error('not hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Encodings of the small-order Ed25519 points (libsodium's blocklist, sign bit ignored). A public
 * key or signature R among them lets one signature pass for any message, so both are refused.
 */
const SMALL_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
].map(fromHex);
const isSmallOrder = (p: Uint8Array) => SMALL_ORDER.some((c) => c.every((b, i) => (i === 31 ? (p[31] & 0x7f) === b : p[i] === b)));

/**
 * For HTTP interactions: check that a request really came from Subspace. Pass the raw body and
 * the X-Signature-Ed25519 and X-Signature-Timestamp headers, with your application's public key.
 * Reject requests older than five minutes. Uses `node:crypto` (Node, Deno, Bun).
 */
export function verifyInteraction(rawBody: string, signature: string, timestamp: string, publicKeyHex: string): boolean {
  if (!isFresh(signature, timestamp)) return false;
  try {
    const key = fromHex(publicKeyHex);
    const sig = fromHex(signature);
    if (key.length !== 32 || sig.length !== 64 || isSmallOrder(key) || isSmallOrder(sig.subarray(0, 32))) return false;
    // An Ed25519 public key in SPKI form: the fixed prefix, then the 32-byte key.
    const der = Buffer.concat([Buffer.from(SPKI_ED25519_PREFIX, 'hex'), Buffer.from(key)]);
    const pub = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(timestamp + rawBody, 'utf8'), pub, Buffer.from(sig));
  } catch {
    return false;
  }
}

/**
 * The same check with WebCrypto (`crypto.subtle`) instead of `node:crypto`: for runtimes such as
 * Cloudflare Workers, or if you prefer the web standard. Needs Ed25519 in WebCrypto (Node 22+,
 * Deno, Bun, current browsers).
 */
export async function verifyInteractionAsync(rawBody: string, signature: string, timestamp: string, publicKeyHex: string): Promise<boolean> {
  if (!isFresh(signature, timestamp)) return false;
  try {
    const key = fromHex(publicKeyHex);
    const sig = fromHex(signature);
    if (key.length !== 32 || sig.length !== 64 || isSmallOrder(key) || isSmallOrder(sig.subarray(0, 32))) return false;
    const subtle = (globalThis as { crypto?: { subtle?: any } }).crypto?.subtle;
    if (!subtle) return false;
    const pub = await subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return (await subtle.verify({ name: 'Ed25519' }, pub, sig, new TextEncoder().encode(timestamp + rawBody))) as boolean;
  } catch {
    return false;
  }
}

/** HTTP interactions: the body of a response that answers right away, or defers. */
export const respondWith = (reply: Reply | string) => ({ type: 4, data: typeof reply === 'string' ? { content: reply } : reply });
export const deferWith = (opts: { ephemeral?: boolean } = {}) => ({ type: 5, data: opts });
