// Discord-flavoured markdown: parser (pure) + React renderer.
import { withTwemoji } from '../../lib/emoji';
import React, { useEffect, useState } from 'react';
import { Tooltip } from '@subspace/ui';
import { isTrustedLink, openLeavingDialog } from '../../lib/links';
import { highlightNow, loadHljs } from '../../lib/highlight';

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'u' | 's' | 'spoiler'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[]; masked: boolean }
  | { t: 'user'; id: string }
  | { t: 'role'; id: string }
  | { t: 'channel'; id: string }
  | { t: 'everyone' | 'here' }
  | { t: 'glyph'; name: string; id: string; animated: boolean }
  | { t: 'timestamp'; unix: number; style: string }
  | { t: 'br' };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'subtext'; c: Inline[] }
  | { t: 'codeblock'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
/** Discord's code block: a language only when a newline follows it; blank edge lines trimmed. */
const CODE_RE = /^```(?:([a-z0-9_+\-.#]+?)\n)?\n*([^\n][\s\S]*?)\n*```/i;
const LIST_RE = /^(\s*)([-*]|(\d{1,9})\.) (.+)$/;

// ---------------------------------------------------------------------------
// Inline parser
// ---------------------------------------------------------------------------

type Rule = { re: RegExp; parse: (m: RegExpExecArray, depth: number) => Inline | null };

const inner = (s: string, depth: number) => parseInline(s, depth + 1);

const RULES: Rule[] = [
  { re: /\\([^A-Za-z0-9\s])/y, parse: (m) => ({ t: 'text', v: m[1] }) },
  { re: /(`+)([\s\S]*?[^`])\1(?!`)/y, parse: (m) => ({ t: 'code', v: m[2].replace(/^ (.*) $/, '$1') }) },
  { re: /<(https?:\/\/[^\s>]+)>/y, parse: (m) => ({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1] }], masked: false }) },
  { re: /<@!?([0-9a-f-]{36})>/y, parse: (m) => ({ t: 'user', id: m[1] }) },
  { re: /<@&([0-9a-f-]{36})>/y, parse: (m) => ({ t: 'role', id: m[1] }) },
  { re: /<#([0-9a-f-]{36})>/y, parse: (m) => ({ t: 'channel', id: m[1] }) },
  { re: /<(a?):([A-Za-z0-9_]{2,32}):([0-9a-f-]{36})>/y, parse: (m) => ({ t: 'glyph', animated: m[1] === 'a', name: m[2], id: m[3] }) },
  { re: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/y, parse: (m) => ({ t: 'timestamp', unix: Number(m[1]), style: m[2] ?? 'f' }) },
  { re: /@(everyone|here)\b/y, parse: (m) => ({ t: m[1] as 'everyone' | 'here' }) },
  {
    re: /\[((?:\[[^\]]*\]|[^\[\]])+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/y,
    parse: (m, d) => (SAFE_URL.test(m[2]) ? { t: 'link', href: m[2], c: inner(m[1], d), masked: true } : null),
  },
  {
    re: /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/y,
    parse: (m) => ({ t: 'link', href: m[0], c: [{ t: 'text', v: m[0] }], masked: false }),
  },
  { re: /\|\|([\s\S]+?)\|\|/y, parse: (m, d) => ({ t: 'spoiler', c: inner(m[1], d) }) },
  { re: /\*\*([\s\S]+?)\*\*(?!\*)/y, parse: (m, d) => ({ t: 'strong', c: inner(m[1], d) }) },
  { re: /__([\s\S]+?)__(?!_)/y, parse: (m, d) => ({ t: 'u', c: inner(m[1], d) }) },
  // *em*: must not start/end with whitespace.
  { re: /\*(?=\S)([\s\S]*?\S)\*(?!\*)/y, parse: (m, d) => ({ t: 'em', c: inner(m[1], d) }) },
  // _em_: only at word boundaries so snake_case stays literal.
  { re: /\b_((?:__|\\[\s\S]|[^\\_])+?)_\b/y, parse: (m, d) => ({ t: 'em', c: inner(m[1], d) }) },
  { re: /~~([\s\S]+?)~~/y, parse: (m, d) => ({ t: 's', c: inner(m[1], d) }) },
  { re: /\n/y, parse: () => ({ t: 'br' }) },
];

const SPECIAL = /[\\`<@\[h|*_~\n]/g;

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  if (depth > 8) return [{ t: 'text', v: src }];
  let i = 0;
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  while (i < src.length) {
    let matched = false;
    // Word-boundary rules (_em_) need the previous char; others are anchored at i.
    for (const rule of RULES) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(src);
      if (!m || m.index !== i) continue;
      const node = rule.parse(m, depth);
      if (!node) continue;
      flush();
      out.push(node);
      i += m[0].length;
      matched = true;
      break;
    }
    if (matched) continue;
    // Consume plain text up to the next character that could start a rule.
    SPECIAL.lastIndex = i + 1;
    const next = SPECIAL.exec(src);
    const end = next ? next.index : src.length;
    text += src.slice(i, end);
    i = end;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

export function parseMarkdown(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Block quotes: ">>> " quotes the rest of the message; "> " quotes one line.
    if (depth < 1 && line.startsWith('>>> ')) {
      flushPara();
      blocks.push({ t: 'quote', c: parseMarkdown([line.slice(4), ...lines.slice(i + 1)].join('\n'), depth + 1) });
      break;
    }
    if (depth < 1 && /^> /.test(line)) {
      flushPara();
      const quoted: string[] = [];
      let j = i;
      while (j < lines.length && /^> /.test(lines[j])) quoted.push(lines[j++].slice(2));
      blocks.push({ t: 'quote', c: parseMarkdown(quoted.join('\n'), depth + 1) });
      i = j - 1;
      continue;
    }

    // Fenced code, like Discord: it can open mid-line, and text after the closing fence stays.
    const k = line.indexOf('```');
    if (k >= 0) {
      const tail = [line.slice(k), ...lines.slice(i + 1)].join('\n');
      const m = CODE_RE.exec(tail);
      if (m) {
        const before = line.slice(0, k);
        if (before.trim()) {
          // Earlier paragraph lines and the text before the fence parse together.
          blocks.push(...parseMarkdown([...para, before].join('\n'), depth));
          para = [];
        } else flushPara();
        blocks.push({ t: 'codeblock', lang: (m[1] ?? '').toLowerCase(), v: m[2] });
        let rest = tail.slice(m[0].length);
        rest = rest.startsWith('\n') ? rest.slice(1) : rest.replace(/^[ \t]+/, '');
        lines.splice(i, lines.length - i, ...(rest ? rest.split('\n') : []));
        i--;
        continue;
      }
    }

    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) {
      flushPara();
      blocks.push({ t: 'h', level: heading[1].length as 1 | 2 | 3, c: parseInline(heading[2]) });
      continue;
    }
    const sub = line.match(/^-# (.+)$/);
    if (sub) {
      flushPara();
      blocks.push({ t: 'subtext', c: parseInline(sub[1]) });
      continue;
    }

    const item = line.match(LIST_RE);
    if (item) {
      flushPara();
      const base = item[1].length;
      const ordered = !!item[3];
      // Each item is its text plus the more-indented lines under it (a nested list).
      const items: Array<{ text: string; sub: string[] }> = [];
      let j = i;
      while (j < lines.length) {
        const m = lines[j].match(LIST_RE);
        if (!m) break;
        if (m[1].length > base) items[items.length - 1].sub.push(lines[j]);
        else if (!!m[3] !== ordered) break;
        else items.push({ text: m[4], sub: [] });
        j++;
      }
      blocks.push({
        t: 'list',
        ordered,
        start: ordered ? Number(item[3]) : 1,
        items: items.map((it) => [{ t: 'p', c: parseInline(it.text) }, ...(it.sub.length ? parseMarkdown(it.sub.join('\n'), depth) : [])]),
      });
      i = j - 1;
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface MarkdownResolvers {
  user?: (id: string) => { label: string; color?: string | null } | null;
  role?: (id: string) => { label: string; color?: string | null } | null;
  channel?: (id: string) => { label: string } | null;
  glyph?: (id: string, name: string) => string | null;
  onUserClick?: (id: string, e: React.MouseEvent) => void;
  onChannelClick?: (id: string) => void;
  /** Highlight @mentions of the viewer. */
  selfId?: string;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\s)+$/u;

function formatTimestamp(unix: number, style: string): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return String(unix);
  const opts: Record<string, Intl.DateTimeFormatOptions> = {
    t: { timeStyle: 'short' },
    T: { timeStyle: 'medium' },
    d: { dateStyle: 'short' },
    D: { dateStyle: 'long' },
    f: { dateStyle: 'long', timeStyle: 'short' },
    F: { dateStyle: 'full', timeStyle: 'short' },
  };
  if (style === 'R') {
    const diff = (d.getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1],
    ];
    for (const [unit, secs] of units) if (Math.abs(diff) >= secs || unit === 'second') return rtf.format(Math.round(diff / secs), unit);
  }
  return new Intl.DateTimeFormat(undefined, opts[style] ?? opts.f).format(d);
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={open ? undefined : 'Spoiler, activate to reveal'}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
      className={
        open
          ? 'rounded-xs bg-white/10 px-0.5'
          : 'rounded-xs bg-fg-disabled text-transparent cursor-pointer select-none px-0.5 [&_*]:invisible'
      }
    >
      {children}
    </span>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [html, setHtml] = useState<string | null>(() => highlightNow(code, lang));
  useEffect(() => {
    setHtml(highlightNow(code, lang));
    if (!lang) return;
    let live = true;
    void loadHljs().then(() => {
      if (live) setHtml(highlightNow(code, lang));
    });
    return () => {
      live = false;
    };
  }, [lang, code]);
  return (
    <pre className="my-1 max-w-[90%] rounded-sm border border-line bg-raised p-2 font-mono text-sm leading-[1.125rem] whitespace-pre-wrap break-words" data-lang={lang || undefined}>
      {/* highlight.js escapes the code; its output is only spans. */}
      {html === null ? <code className="hljs">{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
  );
}

const mentionPill = 'rounded-xs px-0.5 font-medium cursor-pointer bg-brand-soft text-brand-sky hover:bg-brand hover:text-on-brand transition-colors';

function renderInline(nodes: Inline[], r: MarkdownResolvers, big: boolean, keyPrefix = ''): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.t) {
      case 'text':
        // Twemoji like Discord: consistent art, and flags on systems without them.
        return <React.Fragment key={key}>{withTwemoji(n.v, big ? 48 : 22, key)}</React.Fragment>;
      case 'br':
        return <br key={key} />;
      case 'code':
        return (
          <code key={key} className="rounded-xs bg-raised border border-line px-1 py-px font-mono text-[0.85em]">
            {n.v}
          </code>
        );
      case 'strong':
        return <strong key={key} className="font-semibold">{renderInline(n.c, r, big, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(n.c, r, big, key)}</em>;
      case 'u':
        return <u key={key} className="underline-offset-2">{renderInline(n.c, r, big, key)}</u>;
      case 's':
        return <s key={key}>{renderInline(n.c, r, big, key)}</s>;
      case 'spoiler':
        return <Spoiler key={key}>{renderInline(n.c, r, big, key)}</Spoiler>;
      case 'link':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noreferrer noopener"
            title={n.masked ? n.href : undefined}
            className="text-brand-sky hover:underline break-words"
            onClick={(e) => {
              e.stopPropagation();
              if (!isTrustedLink(n.href)) {
                e.preventDefault();
                openLeavingDialog(n.href);
              }
            }}
          >
            {renderInline(n.c, r, big, key)}
          </a>
        );
      case 'user': {
        const u = r.user?.(n.id);
        return (
          <span
            key={key}
            className={mentionPill}
            style={u?.color ? { color: u.color } : undefined}
            onClick={(e) => {
              e.stopPropagation();
              r.onUserClick?.(n.id, e);
            }}
          >
            @{u?.label ?? 'unknown-transmitter'}
          </span>
        );
      }
      case 'role': {
        const role = r.role?.(n.id);
        const c = role?.color ?? undefined;
        return (
          <span
            key={key}
            className="rounded-xs px-0.5 font-medium"
            style={c ? { color: c, backgroundColor: `${c}26` } : undefined}
          >
            @{role?.label ?? 'deleted-clearance'}
          </span>
        );
      }
      case 'channel': {
        const ch = r.channel?.(n.id);
        return (
          <span
            key={key}
            className={mentionPill}
            onClick={(e) => {
              e.stopPropagation();
              if (ch) r.onChannelClick?.(n.id);
            }}
          >
            #{ch?.label ?? 'unknown-relay'}
          </span>
        );
      }
      case 'everyone':
      case 'here':
        return (
          <span key={key} className={mentionPill}>
            @{n.t}
          </span>
        );
      case 'glyph': {
        const url = r.glyph?.(n.id, n.name);
        if (!url) return <React.Fragment key={key}>:{n.name}:</React.Fragment>;
        const size = big ? 'h-12 w-12' : 'h-[1.375em] w-[1.375em]';
        return <img key={key} src={url} alt={`:${n.name}:`} title={`:${n.name}:`} className={`inline-block align-bottom object-contain ${size}`} draggable={false} />;
      }
      case 'timestamp': {
        const d = new Date(n.unix * 1000);
        if (Number.isNaN(d.getTime())) return <React.Fragment key={key}>{formatTimestamp(n.unix, n.style)}</React.Fragment>;
        return (
          <Tooltip key={key} content={formatTimestamp(n.unix, 'F')}>
            <time dateTime={d.toISOString()} className="rounded-xs bg-hover px-1">
              {formatTimestamp(n.unix, n.style)}
            </time>
          </Tooltip>
        );
      }
    }
  });
}

function renderBlocks(blocks: Block[], r: MarkdownResolvers, big: boolean, keyPrefix = ''): React.ReactNode[] {
  return blocks.map((b, i) => {
    const key = `${keyPrefix}b${i}`;
    switch (b.t) {
      case 'p':
        return <div key={key} className="whitespace-pre-wrap break-words">{renderInline(b.c, r, big, key)}</div>;
      case 'h': {
        const cls = { 1: 'text-2xl mt-2 mb-1', 2: 'text-xl mt-2 mb-1', 3: 'text-base mt-1.5' }[b.level];
        return <div key={key} role="heading" aria-level={b.level} className={`font-bold text-fg ${cls}`}>{renderInline(b.c, r, false, key)}</div>;
      }
      case 'subtext':
        return <div key={key} className="text-xs text-fg-subtle">{renderInline(b.c, r, false, key)}</div>;
      case 'codeblock':
        return <CodeBlock key={key} lang={b.lang} code={b.v} />;
      case 'quote':
        return (
          <blockquote key={key} className="my-0.5 flex gap-2">
            <span aria-hidden="true" className="w-1 shrink-0 rounded-full bg-line-strong" />
            <div className="min-w-0">{renderBlocks(b.c, r, false, key)}</div>
          </blockquote>
        );
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag
            key={key}
            start={b.ordered ? b.start : undefined}
            className={`my-0.5 pl-6 ${b.ordered ? 'list-decimal' : 'list-disc [&_ul]:list-[circle] [&_ul_ul]:list-[square]'}`}
          >
            {b.items.map((it, j) => (
              <li key={j}>{renderBlocks(it, r, false, `${key}-${j}`)}</li>
            ))}
          </Tag>
        );
      }
    }
  });
}

/** True when the message is only emoji (unicode or glyphs), shown enlarged like Discord (max 30). */
export function isJumboEmoji(content: string): boolean {
  const withoutGlyphs = content.replace(/<a?:[A-Za-z0-9_]{2,32}:[0-9a-f-]{36}>/g, '');
  const glyphs = (content.match(/<a?:[A-Za-z0-9_]{2,32}:[0-9a-f-]{36}>/g) ?? []).length;
  if (!withoutGlyphs.trim() && glyphs > 0) return glyphs <= 30;
  if (!withoutGlyphs.trim()) return false;
  return EMOJI_ONLY.test(withoutGlyphs) && [...withoutGlyphs.replace(/\s/g, '')].length <= 60;
}

export function Markdown({ content, resolvers = {}, className }: { content: string; resolvers?: MarkdownResolvers; className?: string }) {
  const big = isJumboEmoji(content);
  const blocks = parseMarkdown(content);
  return (
    <div className={`${big ? 'text-[2.75rem] leading-tight' : ''} ${className ?? ''}`}>
      {renderBlocks(blocks, resolvers, big)}
    </div>
  );
}

/** Plain-text preview (reply bars, notifications). */
export function toPlainText(content: string, r: MarkdownResolvers = {}): string {
  const walk = (nodes: Inline[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case 'text':
          case 'code':
            return n.v;
          case 'br':
            return ' ';
          case 'user':
            return `@${r.user?.(n.id)?.label ?? 'unknown'}`;
          case 'role':
            return `@${r.role?.(n.id)?.label ?? 'deleted-clearance'}`;
          case 'channel':
            return `#${r.channel?.(n.id)?.label ?? 'unknown-relay'}`;
          case 'everyone':
          case 'here':
            return `@${n.t}`;
          case 'glyph':
            return `:${n.name}:`;
          case 'timestamp':
            return formatTimestamp(n.unix, n.style);
          case 'spoiler':
            return '[spoiler]';
          default:
            return 'c' in n ? walk(n.c) : '';
        }
      })
      .join('');
  return parseMarkdown(content)
    .map((b) => (b.t === 'codeblock' ? b.v : b.t === 'quote' || b.t === 'list' ? '' : walk(b.c)))
    .join(' ')
    .trim();
}
