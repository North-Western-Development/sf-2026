// Discord-style search syntax: free text plus `key:value` filters.

export const SEARCH_FILTERS = [
  { key: 'from', hint: 'user', description: 'Transmissions from a specific pilot' },
  { key: 'mentions', hint: 'user', description: 'Transmissions that mention a pilot' },
  { key: 'has', hint: 'link, file, image or video', description: 'Transmissions with a link or attachment' },
  { key: 'in', hint: 'relay', description: 'Transmissions in a specific relay', beaconOnly: true },
  { key: 'before', hint: 'YYYY-MM-DD', description: 'Sent before a date' },
  { key: 'during', hint: 'YYYY-MM-DD', description: 'Sent on a date' },
  { key: 'after', hint: 'YYYY-MM-DD', description: 'Sent after a date' },
  { key: 'pinned', hint: 'true', description: 'Only pinned transmissions' },
] as const;

export type FilterKey = (typeof SEARCH_FILTERS)[number]['key'];
export const HAS_VALUES = ['link', 'file', 'image', 'video'] as const;

export interface ParsedSearch {
  text: string;
  filters: Array<{ key: FilterKey; value: string }>;
}

const KEYS = new Set<string>(SEARCH_FILTERS.map((f) => f.key));
// key:value where value is "quoted words" or a single token.
const TOKEN = /(\w+):(?:"([^"]*)"|(\S+))/g;

export function parseSearch(input: string): ParsedSearch {
  const filters: ParsedSearch['filters'] = [];
  const text = input
    .replace(TOKEN, (whole, key: string, quoted: string | undefined, bare: string | undefined) => {
      const k = key.toLowerCase();
      if (!KEYS.has(k)) return whole;
      filters.push({ key: k as FilterKey, value: (quoted ?? bare ?? '').trim() });
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, filters };
}

/** The `key:partial` token the caret is in, for autocomplete. */
export function activeToken(input: string, caret = input.length): { key: FilterKey | null; value: string; start: number } {
  const before = input.slice(0, caret);
  const start = before.search(/\S*$/);
  const word = before.slice(start);
  const m = /^(\w+):(.*)$/.exec(word);
  if (m && KEYS.has(m[1].toLowerCase())) return { key: m[1].toLowerCase() as FilterKey, value: m[2].replace(/^"/, ''), start };
  return { key: null, value: word, start };
}

/** Quote a filter value when it has spaces. */
export const filterToken = (key: FilterKey, value: string) => `${key}:${/\s/.test(value) ? `"${value}"` : value}`;

function dayStart(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface SearchParamsResult {
  params: URLSearchParams;
  /** Filters whose value could not be understood, e.g. an unknown user. */
  errors: string[];
}

/**
 * Turn a parsed query into API params. `resolveUser` and `resolveRelay` map names typed by the
 * user to ids within the current scope.
 */
export function toSearchParams(
  parsed: ParsedSearch,
  resolveUser: (name: string) => string | null,
  resolveRelay: (name: string) => string | null
): SearchParamsResult {
  const params = new URLSearchParams();
  const errors: string[] = [];
  if (parsed.text) params.set('q', parsed.text);
  for (const { key, value } of parsed.filters) {
    if (!value) continue;
    if (key === 'from' || key === 'mentions') {
      const id = resolveUser(value);
      if (id) params.set(key, id);
      else errors.push(`No pilot named "${value}"`);
    } else if (key === 'in') {
      const id = resolveRelay(value.replace(/^#/, ''));
      if (id) params.set('relayId', id);
      else errors.push(`No relay named "${value}"`);
    } else if (key === 'has') {
      const v = value.toLowerCase() === 'embed' ? 'link' : value.toLowerCase() === 'attachment' ? 'file' : value.toLowerCase();
      if ((HAS_VALUES as readonly string[]).includes(v)) params.set('has', v);
      else errors.push(`has: takes link, file, image or video`);
    } else if (key === 'pinned') {
      if (value.toLowerCase() === 'true') params.set('pinned', 'true');
    } else {
      const day = dayStart(value);
      if (!day) {
        errors.push(`${key}: takes a date like 2026-10-23`);
        continue;
      }
      const next = new Date(day.getTime() + 86_400_000);
      if (key === 'before') params.set('before', day.toISOString());
      if (key === 'after') params.set('after', next.toISOString());
      if (key === 'during') {
        params.set('after', new Date(day.getTime() - 1).toISOString());
        params.set('before', next.toISOString());
      }
    }
  }
  return { params, errors };
}

/** True when the query would search for something (text or at least one filter). */
export const hasSearchTerms = (parsed: ParsedSearch) => !!parsed.text || parsed.filters.some((f) => f.value);
