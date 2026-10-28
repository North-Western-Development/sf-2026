import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import net from 'node:net';

/**
 * Spam limits for phone and email verification. Every text costs money and every email counts
 * against the sender's reputation, so codes and links are rationed per account, per number or
 * address and per network address, and finished verifications are rationed too. Nobody verifies
 * a phone from a VPN or proxy, or a number that is not a mobile line (VoIP, landline, toll-free).
 * Each limit is "count/window" (window in m, h or d) and can be changed in the environment:
 *
 *   PHONE_VERIFY_PER_USER    finished verifications per account       default 1/30d
 *   PHONE_VERIFY_PER_IP      finished verifications per address       default 1/72h
 *   PHONE_CODES_PER_USER     codes texted per account                 default 3/24h
 *   PHONE_CODES_PER_NUMBER   codes texted to one number               default 3/24h
 *   PHONE_CODES_PER_IP       codes texted from one address            default 5/72h
 *   PHONE_CODE_ATTEMPTS      wrong guesses before a code is void      default 5
 *   PHONE_COUNTRIES          allowed calling codes, e.g. "+1,+44"     default any
 *   PHONE_LINE_TYPES         Twilio line types allowed                default mobile
 *   PHONE_VPN_CHECK          "proxycheck" (default) or "off"
 *   PROXYCHECK_API_KEY       optional; without one proxycheck.io allows 100 checks a day
 *   PHONE_VPN_BLOCKLIST      optional file of CIDR ranges to refuse (one per line)
 *
 *   EMAIL_VERIFY_PER_USER    finished verifications per account       default 3/30d
 *   EMAIL_VERIFY_PER_IP      finished verifications per address       default 5/72h
 *   EMAIL_CODES_PER_USER     verification emails per account          default 5/24h
 *   EMAIL_CODES_PER_ADDRESS  verification emails to one address       default 3/24h
 *   EMAIL_CODES_PER_IP       verification emails from one address     default 10/24h
 */

export type LimitName =
  | 'PHONE_VERIFY_PER_USER'
  | 'PHONE_VERIFY_PER_IP'
  | 'PHONE_CODES_PER_USER'
  | 'PHONE_CODES_PER_NUMBER'
  | 'PHONE_CODES_PER_IP'
  | 'EMAIL_VERIFY_PER_USER'
  | 'EMAIL_VERIFY_PER_IP'
  | 'EMAIL_CODES_PER_USER'
  | 'EMAIL_CODES_PER_ADDRESS'
  | 'EMAIL_CODES_PER_IP';
const DEFAULTS: Record<LimitName, string> = {
  PHONE_VERIFY_PER_USER: '1/30d',
  PHONE_VERIFY_PER_IP: '1/72h',
  PHONE_CODES_PER_USER: '3/24h',
  PHONE_CODES_PER_NUMBER: '3/24h',
  PHONE_CODES_PER_IP: '5/72h',
  EMAIL_VERIFY_PER_USER: '3/30d',
  EMAIL_VERIFY_PER_IP: '5/72h',
  EMAIL_CODES_PER_USER: '5/24h',
  EMAIL_CODES_PER_ADDRESS: '3/24h',
  EMAIL_CODES_PER_IP: '10/24h',
};
const UNIT: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

export function limit(name: LimitName): { max: number; windowMs: number } {
  const raw = (process.env[name] || DEFAULTS[name]).trim();
  const m = /^(\d+)\s*\/\s*(\d+)\s*([mhd])$/i.exec(raw) ?? /^(\d+)\s*\/\s*(\d+)\s*([mhd])$/i.exec(DEFAULTS[name])!;
  return { max: Number(m[1]), windowMs: Number(m[2]) * UNIT[m[3].toLowerCase()] };
}
export const codeAttempts = () => Math.max(1, Number(process.env.PHONE_CODE_ATTEMPTS) || 5);

const key = (name: LimitName, who: string) => `${name.startsWith('EMAIL') ? 'email' : 'phone'}:${name}:${who.toLowerCase()}`;

/** Whether one more would stay within the limit (a sliding window over Redis timestamps). */
export async function withinLimit(redis: any, name: LimitName, who: string): Promise<boolean> {
  const { max, windowMs } = limit(name);
  const now = Date.now();
  await redis.zremrangebyscore(key(name, who), 0, now - windowMs);
  return (await redis.zcard(key(name, who))) < max;
}
export async function count(redis: any, name: LimitName, who: string) {
  const { windowMs } = limit(name);
  const now = Date.now();
  await redis
    .multi()
    .zadd(key(name, who), now, `${now}-${Math.random()}`)
    .pexpire(key(name, who), windowMs)
    .exec();
}

/** Every limit that applies, checked before anything is sent: the first one hit, or null. */
export async function overLimit(redis: any, checks: Array<[LimitName, string]>): Promise<LimitName | null> {
  for (const [name, who] of checks) if (!(await withinLimit(redis, name, who))) return name;
  return null;
}

export function countryAllowed(phone: string): boolean {
  const list = (process.env.PHONE_COUNTRIES || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return !list.length || list.some((c) => phone.startsWith(c.startsWith('+') ? c : `+${c}`));
}

// ---- VPN and proxy detection ----------------------------------------------

let blocklist: { file: string; ranges: Array<{ v6: boolean; base: bigint; bits: number }> } | null = null;
const toBig = (ip: string): { v6: boolean; n: bigint } | null => {
  const v = net.isIP(ip);
  if (v === 4) return { v6: false, n: ip.split('.').reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n) };
  if (v !== 6) return null;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return { v6: true, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || '0', 16)), 0n) };
};
function onBlocklist(ip: string): boolean {
  const file = process.env.PHONE_VPN_BLOCKLIST;
  if (!file) return false;
  if (blocklist?.file !== file) {
    const ranges: NonNullable<typeof blocklist>['ranges'] = [];
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const [addr, bits] = line.trim().split('/');
        const b = addr && toBig(addr);
        if (!b) continue;
        ranges.push({ v6: b.v6, base: b.n, bits: bits ? Number(bits) : b.v6 ? 128 : 32 });
      }
    } catch {
      /* unreadable: treat as empty */
    }
    blocklist = { file, ranges };
  }
  const me = toBig(ip.replace(/^::ffff:/, ''));
  if (!me) return false;
  return blocklist.ranges.some((r) => {
    if (r.v6 !== me.v6) return false;
    const width = BigInt(me.v6 ? 128 : 32);
    const shift = width - BigInt(r.bits);
    return me.n >> shift === r.base >> shift;
  });
}

/** Loopback, private and link-local addresses: development and tests, never a VPN exit. */
const isLocal = (ip: string) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|f[cd][0-9a-f]{2}:|::ffff:127\.)/i.test(ip);

/**
 * Whether the address is a VPN, proxy or hosting provider. "unknown" when the check could not be
 * made: callers refuse then too, since the point is to stop abuse.
 */
export async function vpnCheck(app: FastifyInstance, ip: string): Promise<'clean' | 'vpn' | 'unknown'> {
  if (onBlocklist(ip)) return 'vpn';
  const mode = (process.env.PHONE_VPN_CHECK || 'proxycheck').toLowerCase();
  if (mode === 'off' || isLocal(ip)) return 'clean';
  const redis = (app as any).redis;
  const cached = redis?.status === 'ready' ? await redis.get(`phone:vpn:${ip}`).catch(() => null) : null;
  if (cached === 'clean' || cached === 'vpn') return cached;
  try {
    const q = new URLSearchParams({ vpn: '3', asn: '1', ...(process.env.PROXYCHECK_API_KEY ? { key: process.env.PROXYCHECK_API_KEY } : {}) });
    const res = await fetch(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?${q}`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as any;
    const entry = body?.[ip];
    if (body?.status === 'error' || !entry) return 'unknown';
    // proxy: "yes" covers VPNs and proxies; type "Hosting" is a datacenter address.
    const verdict = entry.proxy === 'yes' || entry.vpn === 'yes' || /hosting|vpn|tor/i.test(String(entry.type ?? '')) ? 'vpn' : 'clean';
    await redis?.set(`phone:vpn:${ip}`, verdict, 'EX', 86_400).catch(() => {});
    return verdict;
  } catch {
    return 'unknown';
  }
}

// ---- Line type (no VoIP) ----------------------------------------------------

/**
 * What kind of line a number is, from Twilio Lookup (line type intelligence): only the types in
 * PHONE_LINE_TYPES (default "mobile") may be verified, so VoIP, landline, toll-free and the like
 * are refused. "unknown" when the lookup could not be made; callers refuse then too. Without
 * Twilio credentials (development's text outbox) there is nothing to ask, and any line passes.
 */
export async function lineTypeCheck(app: FastifyInstance, phone: string): Promise<{ verdict: 'allowed' | 'refused' | 'unknown'; type?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { verdict: 'allowed' };
  const allowed = (process.env.PHONE_LINE_TYPES || 'mobile').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const redis = (app as any).redis;
  let type: string | null = redis?.status === 'ready' ? await redis.get(`phone:line:${phone}`).catch(() => null) : null;
  if (!type) {
    try {
      const base = (process.env.TWILIO_LOOKUP_BASE || 'https://lookups.twilio.com').replace(/\/$/, '');
      const res = await fetch(`${base}/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`, {
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { verdict: 'unknown' };
      const body = (await res.json()) as any;
      if (body?.valid === false) return { verdict: 'refused', type: 'invalid' };
      type = String(body?.line_type_intelligence?.type ?? '').toLowerCase();
      if (!type) return { verdict: 'unknown' };
      // Lookups cost money: a number's line type rarely changes.
      await redis?.set(`phone:line:${phone}`, type, 'EX', 30 * 86_400).catch(() => {});
    } catch {
      return { verdict: 'unknown' };
    }
  }
  return { verdict: allowed.includes(type.toLowerCase()) ? 'allowed' : 'refused', type };
}
