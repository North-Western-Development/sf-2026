import fs from 'node:fs';
import net from 'node:net';

/**
 * BLOCK_EU=true: the instance refuses people in the EU, the EEA and the UK (it does not comply
 * with the GDPR). Network addresses are looked up in BLOCK_EU_RANGES (default
 * /etc/subspace/eu-ranges.csv): "first,last[,country]" address ranges, one per line, written by
 * deploy/server/eu-ranges.sh from DB-IP's free country database. The file is re-read when it
 * changes. Without it no address is refused (emails and phone numbers still are).
 */
export const blockEu = () => process.env.BLOCK_EU === 'true';

export const REGION_BLOCKED = {
  error: 'Subspace Frequency is not available in your region',
  code: 'REGION_BLOCKED',
} as const;

/** Sent with every refusal: the browser drops this site's cookies. */
export const REGION_BLOCKED_HEADERS = { 'Clear-Site-Data': '"cookies"', 'Cache-Control': 'no-store' } as const;

/**
 * An address with its host part removed: the last octet of IPv4 zeroed, IPv6 cut to its /48.
 * A refused visitor's address is only ever logged like this, never in full.
 */
export function anonymizeIp(raw: string): string {
  const ip = raw.replace(/^::ffff:(?=\d+\.)/i, '');
  if (net.isIPv4(ip)) return ip.replace(/\.\d+$/, '.0');
  const n = ipToBigInt(ip);
  if (!n?.v6) return '';
  const groups = Array.from({ length: 3 }, (_, i) => ((n.n >> BigInt(112 - 16 * i)) & 0xffffn).toString(16));
  return `${groups.join(':')}::`;
}

/** The request log entry Fastify writes, with a refused visitor's address anonymized. */
export function logRequest(req: { method: string; url: string; ip: string }) {
  const blocked = regionBlocked(req.ip);
  return { method: req.method, url: req.url, remoteAddress: blocked ? anonymizeIp(req.ip) : req.ip, ...(blocked ? { regionBlocked: true } : {}) };
}

const DEFAULT_RANGES = '/etc/subspace/eu-ranges.csv';
const RECHECK_MS = 60_000;

type Table = { starts: bigint[]; ends: bigint[] };
let cache: { file: string; mtimeMs: number; checkedAt: number; v4: Table; v6: Table } | null = null;
let warned = false;

/** An address as a number, or null if it is not one. IPv4-mapped IPv6 counts as IPv4. */
export function ipToBigInt(raw: string): { v6: boolean; n: bigint } | null {
  const ip = raw.replace(/^::ffff:(?=\d+\.)/i, '');
  const v = net.isIP(ip);
  if (v === 4) return { v6: false, n: ip.split('.').reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n) };
  if (v !== 6) return null;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return { v6: true, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || '0', 16)), 0n) };
}

function load(file: string): typeof cache {
  const now = Date.now();
  if (cache?.file === file && now - cache.checkedAt < RECHECK_MS) return cache;
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    if (!warned) console.warn(`[BLOCK_EU] no address ranges at ${file}; addresses are not checked`);
    warned = true;
  }
  if (cache?.file === file && cache.mtimeMs === mtimeMs) {
    cache.checkedAt = now;
    return cache;
  }
  const rows: Record<'v4' | 'v6', Array<[bigint, bigint]>> = { v4: [], v6: [] };
  if (mtimeMs >= 0) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [a, b] = line.split(',');
      const first = a && ipToBigInt(a.trim());
      const last = b && ipToBigInt(b.trim());
      if (!first || !last || first.v6 !== last.v6) continue;
      rows[first.v6 ? 'v6' : 'v4'].push([first.n, last.n]);
    }
  }
  const table = (r: Array<[bigint, bigint]>): Table => {
    r.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    // Neighbouring and overlapping ranges merge: lookups only ask "in or out".
    const starts: bigint[] = [];
    const ends: bigint[] = [];
    for (const [s, e] of r) {
      const n = ends.length;
      if (n && s <= ends[n - 1] + 1n) {
        if (e > ends[n - 1]) ends[n - 1] = e;
      } else {
        starts.push(s);
        ends.push(e);
      }
    }
    return { starts, ends };
  };
  cache = { file, mtimeMs, checkedAt: now, v4: table(rows.v4), v6: table(rows.v6) };
  return cache;
}

/** Reads the ranges now (a service calls this at start-up, so no request waits on it). */
export function loadRegionRanges() {
  if (blockEu()) load(process.env.BLOCK_EU_RANGES || DEFAULT_RANGES);
}

/** Whether a client address is in a refused region (always false unless BLOCK_EU=true). */
export function regionBlocked(ip: string | undefined | null): boolean {
  if (!blockEu() || !ip) return false;
  const me = ipToBigInt(ip);
  if (!me) return false;
  const tables = load(process.env.BLOCK_EU_RANGES || DEFAULT_RANGES)!;
  const { starts, ends } = me.v6 ? tables.v6 : tables.v4;
  // The last range starting at or below the address.
  let lo = 0;
  let hi = starts.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= me.n) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at >= 0 && me.n <= ends[at];
}
