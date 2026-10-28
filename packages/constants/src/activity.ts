/**
 * Activity status ("Playing Counter-Strike 2"): what someone is doing right now, shared over the
 * gateway with whoever their Activity Privacy setting allows. It is never stored: it lives in the
 * gateway's memory while they are connected and is gone when they stop or sign off.
 *
 * Two sources fill it, both on the desktop app: games it finds running on the PC ('detected'),
 * and games or apps that report their own Rich Presence over the local RPC server ('rpc').
 */

import games from './games.json';

export const ACTIVITY_TYPES = ['playing', 'streaming', 'listening', 'watching', 'competing'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Activity Privacy: 'off' shares nothing (the default), 'friends' only affiliates, 'everyone' anyone who sees your presence. */
export const ACTIVITY_VISIBILITY = ['off', 'everyone', 'friends'] as const;
export type ActivityVisibility = (typeof ACTIVITY_VISIBILITY)[number];

export interface ActivityButton {
  label: string;
  url: string;
}

export interface Activity {
  type: ActivityType;
  /** The game or app. For Rich Presence it is the application's name. */
  name: string;
  source: 'detected' | 'rpc';
  /** The Subspace application (Developer Applications) that reported it. */
  applicationId?: string;
  /** First and second line under the name, e.g. "Competitive · Mirage" and "In a match". */
  details?: string;
  state?: string;
  /** Unix ms: "for 42m" counts up from startedAt, "3:12 left" down to endsAt. */
  startedAt?: number;
  endsAt?: number;
  /**
   * Images and their hover text. Games report https URLs; the sharer's client swaps them for
   * this instance's media proxy (EMBED_PROXY_PATH) so viewers never load them from the game's host.
   */
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  party?: { size: number; max: number };
  buttons?: ActivityButton[];
}

/** Where activity images are served from on the instance. Viewers show no other images. */
export const EMBED_PROXY_PATH = '/api/v1/embed-proxy?';
/** The instance's own uploads (an application's icon stands in for missing art). */
export const MEDIA_PATH = '/subspace-media/';
const SAME = 'https://instance.invalid';
/**
 * Image addresses on this instance that an activity may carry: the media proxy or our uploads,
 * checked as a browser resolves them (so an encoded "%2e%2e" cannot climb out to another path).
 */
export function isInstanceImage(v: string): boolean {
  if (/[\s"'<>\\]/.test(v) || v.includes('..')) return false;
  let u: URL;
  let path: string;
  try {
    u = new URL(v, SAME);
    path = decodeURIComponent(u.pathname);
  } catch {
    return false;
  }
  if (u.origin !== SAME || path.includes('..') || path.includes('\\')) return false;
  if (v.startsWith(EMBED_PROXY_PATH)) return u.pathname === '/api/v1/embed-proxy';
  return v.startsWith(MEDIA_PATH) && u.pathname.startsWith(MEDIA_PATH);
}

export const ACTIVITY_LIMITS = {
  name: 128,
  text: 128,
  imageUrl: 512,
  proxiedImage: 2048,
  buttonLabel: 32,
  buttons: 2,
  partyMax: 10_000,
} as const;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // No control characters (they would break layouts), no direction overrides or invisible
  // characters (they make one name pass for another), and no surrounding space.
  const s = v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, '').trim();
  return s ? s.slice(0, max) : undefined;
};

const httpsUrl = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string' || v.length > max) return undefined;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** An https URL, or an address on this instance's media proxy. */
const imageRef = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length <= ACTIVITY_LIMITS.proxiedImage && isInstanceImage(v)
    ? v
    : httpsUrl(v, ACTIVITY_LIMITS.imageUrl);

const time = (v: unknown, now: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v - now) < YEAR_MS ? Math.round(v) : undefined;

/**
 * The activity as it may be shared, or null when it is not one. Everything a client sends goes
 * through here (the gateway, and the web app before it sends), so peers only ever see this shape.
 */
export function sanitizeActivity(input: unknown, now = Date.now()): Activity | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  const name = text(a.name, ACTIVITY_LIMITS.name);
  if (!name) return null;
  const out: Activity = {
    type: (ACTIVITY_TYPES as readonly string[]).includes(a.type as string) ? (a.type as ActivityType) : 'playing',
    name,
    source: a.source === 'rpc' ? 'rpc' : 'detected',
  };
  if (typeof a.applicationId === 'string' && /^[1-9][0-9]{0,18}$/.test(a.applicationId)) out.applicationId = a.applicationId;
  const fields = { details: text(a.details, ACTIVITY_LIMITS.text), state: text(a.state, ACTIVITY_LIMITS.text) };
  const images = {
    largeImage: imageRef(a.largeImage),
    largeText: text(a.largeText, ACTIVITY_LIMITS.text),
    smallImage: imageRef(a.smallImage),
    smallText: text(a.smallText, ACTIVITY_LIMITS.text),
  };
  for (const [k, v] of Object.entries({ ...fields, ...images })) if (v) (out as any)[k] = v;
  const startedAt = time(a.startedAt, now);
  const endsAt = time(a.endsAt, now);
  if (startedAt) out.startedAt = startedAt;
  if (endsAt && (!startedAt || endsAt > startedAt)) out.endsAt = endsAt;
  const party = a.party as Record<string, unknown> | undefined;
  if (party && Number.isInteger(party.size) && Number.isInteger(party.max)) {
    const size = party.size as number;
    const max = party.max as number;
    if (size >= 1 && max >= size && max <= ACTIVITY_LIMITS.partyMax) out.party = { size, max };
  }
  if (Array.isArray(a.buttons)) {
    const buttons = a.buttons
      .map((b) => ({ label: text(b?.label, ACTIVITY_LIMITS.buttonLabel), url: httpsUrl(b?.url, ACTIVITY_LIMITS.imageUrl) }))
      .filter((b): b is ActivityButton => !!b.label && !!b.url)
      .slice(0, ACTIVITY_LIMITS.buttons);
    if (buttons.length) out.buttons = buttons;
  }
  return out;
}

/** Whether two activities would look the same (startedAt included): saves re-sending identical updates. */
export const sameActivity = (a: Activity | null, b: Activity | null) => JSON.stringify(a) === JSON.stringify(b);

// --- Games the desktop app detects ---------------------------------------------------------------

/**
 * The games the desktop app looks for (games.json, which it compiles in): the name shown, its
 * executables (lowercase), and its Steam app id when it is on Steam.
 */
export const DETECTED_GAMES: ReadonlyArray<{ name: string; exe: string[]; steam?: number }> = games;

const steamIds = new Map(DETECTED_GAMES.filter((g) => g.steam).map((g) => [g.name, g.steam!]));

/** Whether a name is one of the detected games. */
export const isDetectedGame = (name: string) => DETECTED_GAMES.some((g) => g.name === name);

/**
 * A detected game's cover: the Steam store's 600x900 portrait capsule on Steam's CDN. Shown only
 * through the instance's media proxy. A developer's own art (a verified application) takes its place.
 */
export function steamCoverOf(name: string): string | undefined {
  const id = steamIds.get(name);
  return id ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg` : undefined;
}
