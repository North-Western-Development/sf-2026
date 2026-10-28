import { EMOJI_RE, emojiUrl, findEmoji } from '../../lib/emoji';
import { highlightNow } from '../../lib/highlight';
import { glyphUrl } from '../chat/resolvers';

/**
 * The message editor's live preview, like Discord's: the markdown characters stay in the text
 * (what you type is what is sent), and what they do shows around them. Closed ``` blocks are
 * monospace and syntax coloured, `code` and ||spoilers|| get their boxes, and bold, italic,
 * underline and strikethrough show as such. Emoji and glyphs are images.
 */

type Mark = 'b' | 'i' | 'u' | 's' | 'spoiler' | 'code';
interface Range {
  a: number;
  b: number;
}
export interface Fence extends Range {
  lang: string;
  /** The code between the fences. */
  bodyA: number;
  bodyB: number;
}

const GLYPH_SRC = '<a?:[A-Za-z0-9_]{2,32}:[1-9][0-9]{0,18}>';
const TOKEN_RE = new RegExp(`${GLYPH_SRC}|${EMOJI_RE.source}`, 'gu');
const GLYPH_RE = /^<a?:([A-Za-z0-9_]{2,32}):([1-9][0-9]{0,18})>$/;

const FENCE_RE = /```(?:([a-z0-9_+\-.#]+)\n)?([\s\S]*?)```/gi;
const CODE_RE = /`([^`\n]+)`/g;
const MARK_RES: Array<[Mark, RegExp]> = [
  ['spoiler', /\|\|([\s\S]+?)\|\|/g],
  ['b', /\*\*([\s\S]+?)\*\*/g],
  ['u', /__([\s\S]+?)__/g],
  ['s', /~~([\s\S]+?)~~/g],
  ['i', /(?<![*\\])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?!\*)/g],
  ['i', /(?<![\w_])_(?!_)([^_\n]+?)_(?![\w_])/g],
];

/** Closed code blocks (with something in them). */
export function findFences(text: string): Fence[] {
  const out: Fence[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    if (!/[^\n]/.test(m[2])) continue;
    const a = m.index!;
    const bodyA = a + 3 + (m[1] ? m[1].length + 1 : 0);
    out.push({ a, b: a + m[0].length, lang: (m[1] ?? '').toLowerCase(), bodyA, bodyB: a + m[0].length - 3 });
  }
  return out;
}

/** Inline marks inside one stretch of text outside code blocks. */
function findMarks(text: string, offset: number): Array<Range & { mark: Mark }> {
  const out: Array<Range & { mark: Mark }> = [];
  const code: Range[] = [];
  for (const m of text.matchAll(CODE_RE)) {
    code.push({ a: m.index!, b: m.index! + m[0].length });
    out.push({ a: offset + m.index!, b: offset + m.index! + m[0].length, mark: 'code' });
  }
  const inCode = (a: number, b: number) => code.some((c) => a < c.b && b > c.a);
  for (const [mark, re] of MARK_RES) {
    for (const m of text.matchAll(re)) {
      const a = m.index!;
      const b = a + m[0].length;
      if (!inCode(a, b)) out.push({ a: offset + a, b: offset + b, mark });
    }
  }
  return out;
}

/** An emoji or glyph image for raw text, or null when it should stay as text. */
function tokenImage(raw: string): HTMLImageElement | null {
  const glyph = GLYPH_RE.exec(raw);
  const img = document.createElement('img');
  img.draggable = false;
  img.dataset.raw = raw;
  img.className = 'rich-emoji';
  if (glyph) {
    const url = glyphUrl(glyph[2]);
    if (!url) return null;
    img.src = url;
    img.alt = `:${glyph[1]}:`;
    return img;
  }
  const hit = findEmoji(raw);
  if (!hit) return null;
  img.src = emojiUrl(hit.chars);
  img.alt = raw;
  return img;
}

/** Text with emoji and glyphs as images. */
function inline(text: string, into: Node) {
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const img = tokenImage(m[0]);
    if (!img) continue;
    if (m.index! > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
    into.appendChild(img);
    last = m.index! + m[0].length;
  }
  if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
}

function span(className: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  return el;
}

/** Class names for a stretch covered by these marks. */
function markClass(marks: Set<Mark>): string {
  const cls: string[] = [];
  if (marks.has('b')) cls.push('md-b');
  if (marks.has('i')) cls.push('md-i');
  if (marks.has('u') && marks.has('s')) cls.push('md-us');
  else if (marks.has('u')) cls.push('md-u');
  else if (marks.has('s')) cls.push('md-s');
  if (marks.has('code')) cls.push('md-code');
  if (marks.has('spoiler')) cls.push('md-spoiler');
  return cls.join(' ');
}

/** Plain text outside code blocks, split wherever the set of marks changes. */
function marked(text: string, offset: number, into: Node) {
  const marks = findMarks(text, offset);
  if (!marks.length) return inline(text, into);
  const cuts = new Set([offset, offset + text.length]);
  for (const m of marks) cuts.add(m.a).add(m.b);
  const points = [...cuts].sort((x, y) => x - y);
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const on = new Set(marks.filter((m) => m.a <= a && m.b >= b).map((m) => m.mark));
    const part = text.slice(a - offset, b - offset);
    if (!on.size) inline(part, into);
    else {
      const el = span(markClass(on));
      inline(part, el);
      into.appendChild(el);
    }
  }
}

/** The editor's DOM for a value. */
export function build(value: string): Node[] {
  const root = document.createDocumentFragment();
  let at = 0;
  for (const f of findFences(value)) {
    if (f.a > at) marked(value.slice(at, f.a), at, root);
    const open = span('md-fence');
    open.textContent = value.slice(f.a, f.bodyA);
    const body = span('md-codeblock');
    const code = value.slice(f.bodyA, f.bodyB);
    const html = highlightNow(code, f.lang);
    // highlight.js escapes the code; its output is only spans.
    if (html !== null) body.innerHTML = html;
    else body.textContent = code;
    const close = span('md-fence');
    close.textContent = '```';
    root.append(open, body, close);
    at = f.b;
  }
  if (at < value.length) marked(value.slice(at), at, root);
  // A trailing newline needs something after it to show the empty last line.
  if (value.endsWith('\n')) {
    const br = document.createElement('br');
    br.dataset.trail = '1';
    root.appendChild(br);
  }
  return Array.from(root.childNodes);
}

/** Leaf nodes that stand for text: text nodes, emoji images and line breaks. */
const isLeaf = (n: Node) => n.nodeType === Node.TEXT_NODE || (n as HTMLElement).tagName === 'IMG' || (n as HTMLElement).tagName === 'BR';
const isBlock = (n: Node) => (n as HTMLElement).tagName === 'DIV' || (n as HTMLElement).tagName === 'P';

/** Plain-text length a node stands for. */
export function lengthOf(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue ?? '').length;
  const el = n as HTMLElement;
  if (el.tagName === 'IMG') return (el.dataset.raw ?? (el as HTMLImageElement).alt ?? '').length;
  // Our trailing <br>, and the one browsers leave in an emptied box or line, are not newlines.
  if (el.tagName === 'BR') return el.dataset.trail || !el.nextSibling ? 0 : 1;
  let len = 0;
  el.childNodes.forEach((c) => (len += lengthOf(c)));
  // Browser-made line containers start a new line.
  if (isBlock(el) && el.previousSibling) len += 1;
  return len;
}

/** The editor's value: its children's text (the editor itself is not a line of its own). */
export function serializeRoot(root: HTMLElement): string {
  let s = '';
  root.childNodes.forEach((c) => (s += serialize(c)));
  return s;
}

function serialize(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return n.nodeValue ?? '';
  const el = n as HTMLElement;
  if (el.tagName === 'IMG') return el.dataset.raw ?? (el as HTMLImageElement).alt ?? '';
  if (el.tagName === 'BR') return el.dataset.trail || !el.nextSibling ? '' : '\n';
  let s = '';
  el.childNodes.forEach((c) => (s += serialize(c)));
  if (isBlock(el) && el.previousSibling) s = `\n${s}`;
  return s;
}

/** Plain-text offset of a DOM position inside root. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  let total = 0;
  let found = false;
  const walk = (n: Node) => {
    if (found) return;
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) total += offset;
      else for (let i = 0; i < offset && i < n.childNodes.length; i++) total += lengthOf(n.childNodes[i]);
      found = true;
      return;
    }
    if (n !== root && isLeaf(n)) {
      total += lengthOf(n);
      return;
    }
    if (n !== root && isBlock(n) && n.previousSibling) total += 1;
    n.childNodes.forEach(walk);
  };
  walk(root);
  return total;
}

/** A DOM position for a plain-text offset inside root. */
export function positionOf(root: HTMLElement, pos: number): [Node, number] {
  let left = Math.max(0, pos);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (isLeaf(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = lengthOf(n);
    if (n.nodeType === Node.TEXT_NODE) {
      if (left <= len) return [n, left];
    } else if (left === 0) {
      return [n.parentNode!, Array.prototype.indexOf.call(n.parentNode!.childNodes, n)];
    } else if (left < len) {
      // Inside an image's text: snap to after it.
      return [n.parentNode!, Array.prototype.indexOf.call(n.parentNode!.childNodes, n) + 1];
    }
    left -= len;
  }
  const trail = root.lastChild as HTMLElement | null;
  return [root, trail?.tagName === 'BR' ? root.childNodes.length - 1 : root.childNodes.length];
}
