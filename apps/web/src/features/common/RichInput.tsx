import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { EMOJI_RE, findEmoji, spriteCss } from '../../lib/emoji';
import { glyphUrl } from '../chat/resolvers';

/**
 * Discord-style message editor. The value is plain text (what is sent: unicode emoji and
 * `<:name:id>` glyph tokens); the editor shows every emoji and glyph as an inline image with
 * Discord's spacing, which a textarea cannot. Typing, IME, paste, cut/copy, Shift+Enter,
 * undo/redo and the caret (as a plain-text offset) all work on that text.
 */

export interface RichInputHandle {
  focus(): void;
  /** Selection as plain-text offsets. */
  getSelection(): [number, number];
  setCaret(pos: number): void;
  /** Replaces the selection (or inserts at the caret) and reports the change. */
  insert(text: string): void;
  readonly element: HTMLDivElement | null;
}

const GLYPH_SRC = '<a?:[A-Za-z0-9_]{2,32}:[0-9a-f-]{36}>';
const TOKEN_RE = new RegExp(`${GLYPH_SRC}|${EMOJI_RE.source}`, 'gu');
const GLYPH_RE = /^<a?:([A-Za-z0-9_]{2,32}):([0-9a-f-]{36})>$/;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const EMOJI_PX = 22;

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
  img.src = BLANK;
  img.alt = raw;
  Object.assign(img.style, spriteCss(hit.x, hit.y, EMOJI_PX));
  return img;
}

function build(value: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN_RE)) {
    const img = tokenImage(m[0]);
    if (!img) continue;
    if (m.index! > last) out.push(document.createTextNode(value.slice(last, m.index)));
    out.push(img);
    last = m.index! + m[0].length;
  }
  if (last < value.length) out.push(document.createTextNode(value.slice(last)));
  // A trailing newline needs something after it to show the empty last line.
  if (value.endsWith('\n')) {
    const br = document.createElement('br');
    br.dataset.trail = '1';
    out.push(br);
  }
  return out;
}

/** Plain-text length a node stands for. */
function lengthOf(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue ?? '').length;
  const el = n as HTMLElement;
  if (el.tagName === 'IMG') return (el.dataset.raw ?? (el as HTMLImageElement).alt ?? '').length;
  if (el.tagName === 'BR') return el.dataset.trail ? 0 : 1;
  let len = 0;
  el.childNodes.forEach((c) => (len += lengthOf(c)));
  // Browser-made line containers start a new line.
  if ((el.tagName === 'DIV' || el.tagName === 'P') && el.previousSibling) len += 1;
  return len;
}

function serialize(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return n.nodeValue ?? '';
  const el = n as HTMLElement;
  if (el.tagName === 'IMG') return el.dataset.raw ?? (el as HTMLImageElement).alt ?? '';
  if (el.tagName === 'BR') return el.dataset.trail ? '' : '\n';
  let s = '';
  el.childNodes.forEach((c) => (s += serialize(c)));
  if ((el.tagName === 'DIV' || el.tagName === 'P') && el.previousSibling) s = `\n${s}`;
  return s;
}

/** Plain-text offset of a DOM position inside root. */
function offsetOf(root: Node, node: Node, offset: number): number {
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
    if (n !== root && (n.nodeType === Node.TEXT_NODE || (n as HTMLElement).tagName === 'IMG' || (n as HTMLElement).tagName === 'BR')) {
      total += lengthOf(n);
      return;
    }
    if (n !== root && ((n as HTMLElement).tagName === 'DIV' || (n as HTMLElement).tagName === 'P') && n.previousSibling) total += 1;
    n.childNodes.forEach(walk);
  };
  walk(root);
  return total;
}

/** Whether the DOM differs from what `build` makes (pasted spans, typed emoji, browser divs). */
function needsRebuild(root: HTMLElement): boolean {
  for (const c of Array.from(root.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) {
      for (const m of (c.nodeValue ?? '').matchAll(TOKEN_RE)) if (GLYPH_RE.test(m[0]) ? glyphUrl(GLYPH_RE.exec(m[0])![2]) : findEmoji(m[0])) return true;
      continue;
    }
    const el = c as HTMLElement;
    if (el.tagName === 'IMG' && el.dataset.raw) continue;
    if (el.tagName === 'BR' && el.dataset.trail && !el.nextSibling) continue;
    return true;
  }
  return false;
}

type Props = {
  value: string;
  onChange: (value: string, caret: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called after clicks and arrow keys move the caret. */
  onCaret?: (caret: number) => void;
  /** Files pasted into the editor; return true when handled. */
  onPasteFiles?: (files: FileList) => boolean;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  /** Applied to the outer box (sizing, background). */
  wrapperClassName?: string;
};

export const RichInput = forwardRef<RichInputHandle, Props>(function RichInput(
  { value, onChange, onKeyDown, onCaret, onPasteFiles, placeholder, className, wrapperClassName, ...aria },
  ref
) {
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const composing = useRef(false);
  /** The last selection inside the editor, restored when focus comes back (e.g. after the emoji picker). */
  const saved = useRef<[number, number] | null>(null);
  const history = useRef<{ stack: Array<{ v: string; c: number }>; at: number; last: number }>({ stack: [{ v: value, c: value.length }], at: 0, last: 0 });

  const render = (v: string) => {
    root.current!.replaceChildren(...build(v));
    shown.current = v;
  };
  const getSelection = (): [number, number] => {
    const el = root.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return [shown.current?.length ?? 0, shown.current?.length ?? 0];
    const r = sel.getRangeAt(0);
    const a = offsetOf(el, r.startContainer, r.startOffset);
    const b = offsetOf(el, r.endContainer, r.endOffset);
    return [Math.min(a, b), Math.max(a, b)];
  };
  const setCaret = (pos: number) => {
    const el = root.current;
    if (!el) return;
    const range = document.createRange();
    let left = Math.max(0, pos);
    let placed = false;
    const kids = Array.from(el.childNodes);
    for (let i = 0; i < kids.length && !placed; i++) {
      const c = kids[i];
      const len = lengthOf(c);
      if (c.nodeType === Node.TEXT_NODE && left <= len) {
        range.setStart(c, left);
        placed = true;
      } else if (c.nodeType !== Node.TEXT_NODE && left < len) {
        // Inside an image's text: snap to after it.
        range.setStart(el, i + 1);
        placed = true;
      } else if (c.nodeType !== Node.TEXT_NODE && left === 0) {
        range.setStart(el, i);
        placed = true;
      } else left -= len;
    }
    if (!placed) {
      const trail = el.lastChild as HTMLElement | null;
      range.setStart(el, trail?.dataset?.trail ? kids.length - 1 : kids.length);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const record = (v: string, c: number, merge: boolean) => {
    const h = history.current;
    const now = Date.now();
    if (h.stack[h.at]?.v === v) return;
    h.stack = h.stack.slice(0, h.at + 1);
    // Typing within a second groups into one undo step.
    if (merge && now - h.last < 1000 && h.at > 0) h.stack[h.at] = { v, c };
    else h.stack.push({ v, c });
    h.at = h.stack.length - 1;
    h.last = merge ? now : 0;
    if (h.stack.length > 200) {
      h.stack.shift();
      h.at--;
    }
  };
  const commit = (v: string, c: number, merge = false) => {
    record(v, c, merge);
    onChange(v, c);
  };
  const restore = () => {
    const el = root.current;
    if (!el || document.activeElement === el) return;
    el.focus();
    const [a, b] = saved.current ?? [shown.current?.length ?? 0, shown.current?.length ?? 0];
    setCaret(b);
    if (a !== b) {
      // Re-select a saved range.
      const sel = window.getSelection();
      const end = sel?.getRangeAt(0);
      setCaret(a);
      const start = sel?.getRangeAt(0);
      if (sel && start && end) {
        const r = document.createRange();
        r.setStart(start.startContainer, start.startOffset);
        r.setEnd(end.startContainer, end.startOffset);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
  };
  const insert = (text: string) => {
    restore();
    const [s, e] = getSelection();
    const cur = shown.current ?? '';
    const next = cur.slice(0, s) + text + cur.slice(e);
    render(next);
    setCaret(s + text.length);
    commit(next, s + text.length);
  };

  useImperativeHandle(ref, () => ({
    focus: restore,
    getSelection,
    setCaret: (p) => {
      root.current?.focus();
      setCaret(p);
    },
    insert,
    get element() {
      return root.current;
    },
  }));

  // Remember where the caret was whenever the selection moves inside the editor.
  useEffect(() => {
    const track = () => {
      const el = root.current;
      const sel = window.getSelection();
      if (el && sel?.rangeCount && el.contains(sel.anchorNode)) saved.current = getSelection();
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, []);

  // Outside changes (sent, cleared, channel switch, a picked suggestion) redraw the editor.
  useLayoutEffect(() => {
    if (value === shown.current) return;
    const focused = document.activeElement === root.current;
    render(value);
    if (focused || pendingCaret.current !== null) setCaret(pendingCaret.current ?? value.length);
    pendingCaret.current = null;
    if (!value) history.current = { stack: [{ v: '', c: 0 }], at: 0, last: 0 };
  }, [value]);

  const onInput = () => {
    const el = root.current!;
    if (composing.current) return;
    const v = serialize(el);
    const [, caret] = getSelection();
    if (needsRebuild(el)) {
      render(v);
      setCaret(caret);
    } else shown.current = v;
    commit(v, caret, true);
  };

  const undoRedo = (dir: -1 | 1) => {
    const h = history.current;
    const at = h.at + dir;
    if (at < 0 || at >= h.stack.length) return;
    h.at = at;
    h.last = 0;
    const { v, c } = h.stack[at];
    render(v);
    setCaret(c);
    onChange(v, c);
  };

  return (
    <div className={clsx('relative', wrapperClassName)}>
      {!value && placeholder && (
        <span aria-hidden className={clsx(className, 'pointer-events-none absolute inset-0 overflow-hidden truncate whitespace-nowrap text-fg-subtle')}>
          {placeholder}
        </span>
      )}
      <div
        ref={root}
        role="textbox"
        aria-multiline="true"
        aria-label={aria['aria-label']}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={onInput}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          onInput();
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undoRedo(e.shiftKey ? 1 : -1);
            return;
          }
          if (mod && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            undoRedo(1);
            return;
          }
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Enter') {
            // Shift+Enter (or Enter the caller left alone) is a new line, as plain text.
            e.preventDefault();
            insert('\n');
          }
        }}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') onCaret?.(getSelection()[1]);
        }}
        onMouseUp={() => onCaret?.(getSelection()[1])}
        onPaste={(e) => {
          e.preventDefault();
          if (e.clipboardData.files.length && onPasteFiles?.(e.clipboardData.files)) return;
          const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
          if (text) insert(text);
        }}
        onCopy={(e) => {
          const [s, end] = getSelection();
          if (s === end) return;
          e.preventDefault();
          e.clipboardData.setData('text/plain', (shown.current ?? '').slice(s, end));
        }}
        onCut={(e) => {
          const [s, end] = getSelection();
          if (s === end) return;
          e.preventDefault();
          e.clipboardData.setData('text/plain', (shown.current ?? '').slice(s, end));
          insert('');
        }}
        onDrop={(e) => {
          // Dropped files are the composer's business; dropped text would bring markup.
          if (!e.dataTransfer.files.length) e.preventDefault();
        }}
        className={clsx(className, 'overflow-y-auto whitespace-pre-wrap break-words outline-none [&_.rich-emoji]:inline-block')}
      />
    </div>
  );
});
