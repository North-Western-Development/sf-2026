import crypto from 'node:crypto';
import { and, eq, inArray, appActivities, devTeams, oauthApps, oauthGrants, transmitters } from '@subspace/database';
import { appRoleAtLeast } from '@subspace/constants';
import { appRole } from './app-access.js';
import { resolveSafe } from './safe-fetch.js';

/**
 * Custom Activities: an application's web page that people open together in a comm-link.
 *
 * Security model (apps/docs/developers/activities.md has the full write-up):
 *  - The page runs in a sandboxed <iframe> on the developer's own https origin. It is never our
 *    origin or a host under our site, so `allow-same-origin` only lets it keep ITS origin; it can
 *    never reach into ours. Same-site hosts are refused because they could toss cookies onto us.
 *  - It learns nothing ambiently: the client hands it a public profile and the participant list
 *    over postMessage, after the person accepted a privacy notice for that app.
 *  - Staff approve an Activity before anyone outside the app's team can launch or join it. A new
 *    URL is a new page, so it needs approving again.
 *  - Identity for the activity's backend comes only from an OAuth2 code minted here for that app
 *    and that person, which the backend exchanges with its client secret.
 */

export const ACTIVITY_URL_MAX = 500;
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** This instance's own hostnames (PUBLIC_ORIGIN, comma-separated). */
function ownHosts(): string[] {
  return (process.env.PUBLIC_ORIGIN || '')
    .split(',')
    .map((o) => {
      try {
        return new URL(o.trim()).hostname.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

/**
 * The site a host belongs to, roughly: drop the first label of a name with three or more
 * (chat.example.com -> example.com). Over-broad for public suffixes like co.uk, which only means
 * we refuse more than we must, never less.
 */
const siteOf = (host: string) => {
  const labels = host.split('.');
  return labels.length >= 3 && !/^\d+$/.test(labels[labels.length - 1]) ? labels.slice(1).join('.') : host;
};

/** Whether a host is ours or same-site with us (subdomains can set cookies for our site). */
export function isOwnSite(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ownHosts().some((own) => {
    if (host === own) return true;
    if (LOOPBACK.includes(own)) return false; // localhost has no "site" to share
    const site = siteOf(own);
    return host === site || host.endsWith(`.${site}`);
  });
}

/**
 * An Activity URL a developer registers: https (http only to this machine outside production),
 * no credentials or #fragment (the client puts its handshake there), not on our own site, and not
 * resolving to a private or loopback address (in production; tests allow-list localhost).
 */
export async function checkActivityUrl(raw: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a URL' };
  }
  const prod = process.env.NODE_ENV === 'production';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !prod && LOOPBACK.includes(url.hostname))) return { ok: false, error: 'Activities must be served over https://' };
  if (url.username || url.password) return { ok: false, error: 'Leave the username and password out of the URL' };
  if (url.hash) return { ok: false, error: 'Leave the #fragment out: Subspace adds its own' };
  if (isOwnSite(url.hostname)) return { ok: false, error: 'Activities must run on your own domain, not on this instance or a subdomain of it' };
  try {
    await resolveSafe(url);
  } catch {
    return { ok: false, error: 'That host is not public (private, loopback or unresolvable addresses are refused)' };
  }
  const out = url.toString();
  if (out.length > ACTIVITY_URL_MAX) return { ok: false, error: 'That URL is too long' };
  return { ok: true, url: out };
}

export interface ActivityAppInfo {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  /** The team's name, or the owner's username. */
  developer: string;
  url: string;
  maxParticipants: number;
  approved: boolean;
  ownerId: string;
  teamId: string | null;
}

/** An application's Activity with what the launcher shows, or null. */
export async function loadActivityApp(db: any, appId: string): Promise<ActivityAppInfo | null> {
  const [row] = await db
    .select({ act: appActivities, app: oauthApps, owner: transmitters.username, team: devTeams.name })
    .from(appActivities)
    .innerJoin(oauthApps, eq(oauthApps.id, appActivities.appId))
    .innerJoin(transmitters, eq(transmitters.id, oauthApps.ownerId))
    .leftJoin(devTeams, eq(devTeams.id, oauthApps.teamId))
    .where(eq(appActivities.appId, appId))
    .limit(1);
  return row ? toInfo(row) : null;
}

const toInfo = (row: any): ActivityAppInfo => ({
  id: row.app.id,
  name: row.act.name,
  description: row.act.description,
  iconUrl: row.app.iconUrl,
  developer: row.team ?? row.owner,
  url: row.act.url,
  maxParticipants: row.act.maxParticipants,
  approved: !!row.act.approvedAt,
  ownerId: row.app.ownerId,
  teamId: row.app.teamId ?? null,
});

/** Approved Activities, plus unapproved ones of apps I develop (to test them). */
export async function launchableActivities(db: any, transmitterId: string): Promise<ActivityAppInfo[]> {
  const rows = await db
    .select({ act: appActivities, app: oauthApps, owner: transmitters.username, team: devTeams.name })
    .from(appActivities)
    .innerJoin(oauthApps, eq(oauthApps.id, appActivities.appId))
    .innerJoin(transmitters, eq(transmitters.id, oauthApps.ownerId))
    .leftJoin(devTeams, eq(devTeams.id, oauthApps.teamId))
    .orderBy(appActivities.name)
    .limit(500);
  const out: ActivityAppInfo[] = [];
  for (const row of rows) {
    const info = toInfo(row);
    if (await mayLaunch(db, info, transmitterId)) out.push(info);
  }
  return out;
}

/** Everyone may launch an approved Activity; before approval only its team (developer role or above). */
export async function mayLaunch(db: any, info: ActivityAppInfo, transmitterId: string) {
  if (info.approved) return true;
  return appRoleAtLeast(await appRole(db, { ownerId: info.ownerId, teamId: info.teamId }, transmitterId), 'developer');
}

/** What clients get. `url` only for people about to load it. */
export const publicActivityApp = (info: ActivityAppInfo, withUrl = false) => ({
  id: info.id,
  name: info.name,
  description: info.description,
  iconUrl: info.iconUrl,
  developer: info.developer,
  maxParticipants: info.maxParticipants,
  approved: info.approved,
  /** Where it runs: the privacy notice names it, and the client re-asks if it ever changes. */
  origin: new URL(info.url).origin,
  ...(withUrl ? { url: info.url } : {}),
});

/** The public profile an activity sees of each participant. */
export async function publicProfiles(db: any, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: transmitters.id, username: transmitters.username, displayName: transmitters.displayName, avatarUrl: transmitters.avatarUrl })
    .from(transmitters)
    .where(inArray(transmitters.id, ids));
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null }>;
}

/** Existing consent that already covers these scopes (so the in-app prompt can be skipped). */
export async function grantCovers(db: any, appId: string, transmitterId: string, scopes: string[]) {
  const [g] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.appId, appId), eq(oauthGrants.transmitterId, transmitterId))).limit(1);
  return !!g && scopes.every((s) => g.scopes.includes(s));
}

const CODE_TTL_S = 600;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * An OAuth2 authorization code for an Activity, in the same store /oauth2/token redeems. It has
 * no redirect URI (nothing is redirected: the client hands it to the frame), so the token request
 * must not send one; it is bound to the app, the person and the activity instance, single use,
 * ten minutes.
 */
export async function mintActivityCode(redis: any, c: { appId: string; transmitterId: string; scopes: string[]; activityId: string }) {
  const code = crypto.randomBytes(32).toString('base64url');
  await redis.set(`oauth:code:${sha(code)}`, JSON.stringify({ ...c, redirectUri: null, challenge: null }), 'EX', CODE_TTL_S);
  return code;
}
