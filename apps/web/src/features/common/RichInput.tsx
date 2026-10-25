import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Bold, Code, EyeOff, Italic, Strikethrough, TextQuote, type LucideIcon } from 'lucide-react';
import { hljsReady, loadHljs } from '../../lib/highlight';
import { build, findFences, offsetOf, positionOf, serializeRoot } from './richMarkup';

/**
 * Discord-style message editor. The value is plain text (what is sent: unicode emoji and
 * `<:name:id>` glyph tokens); the editor shows every emoji and glyph as an inline image with
 * Discord's spacing, and previews markdown as you type (see richMarkup), which a textarea
 * cannot. Typing, IME, paste, cut/copy, Shift+Enter, undo/redo and the caret (as a plain-text
 * offset) all work on that text.
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

const SHORTCUTS: Record<string, string> = { b: '**', i: '*', u: '__' };
const MARKERS = ['**', '*', '~~', '`', '||'];
const TOOLS: Array<{ label: string; icon: LucideIcon; marker?: string } | null> = [
  { label: 'Bold', icon: Bold, marker: '**' },
  { label: 'Italic', icon: Italic, marker: '*' },
  { label: 'Strikethrough', icon: Strikethrough, marker: '~~' },
  null,
  { label: 'Quote', icon: TextQuote },
  { label: 'Code', icon: Code, marker: '`' },
  { label: 'Spoiler', icon: EyeOff, marker: '||' },
];

/** The markers sit just outside the selection: **[x]**. */
function wrappedOutside(text: string, s: number, e: number, m: string): boolean {
  if (s === e || s < m.length || text.slice(s - m.length, s) !== m || text.slice(e, e + m.length) !== m) return false;
  // A lone * next to another * is bold, not italic.
  return m !== '*' || (text[s - 2] !== '*' && text[e + 1] !== '*');
}
/** The selection includes the markers: [**x**]. */
function wrappedInside(text: string, s: number, e: number, m: string): boolean {
  if (e - s < 2 * m.length || !text.startsWith(m, s) || text.slice(e - m.length, e) !== m) return false;
  return m !== '*' || (text[s + 1] !== '*' && text[e - 2] !== '*');
}

/** An odd number of ``` before the caret means it is inside a code block (closed or not). */
export function inCodeBlock(text: string, caret: number): boolean {
  return (text.slice(0, caret).match(/```/g)?.length ?? 0) % 2 === 1;
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
  /** Markdown shortcuts (Ctrl+B/I/U) and the menu over a selection. On by default. */
  formatting?: boolean;
};

export const RichInput = forwardRef<RichInputHandle, Props>(function RichInput(
  { value, onChange, onKeyDown, onCaret, onPasteFiles, placeholder, className, wrapperClassName, formatting = true, ...aria },
  ref
) {
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const composing = useRef(false);
  /** The last selection inside the editor, restored when focus comes back (e.g. after the emoji picker). */
  const saved = useRef<[number, number] | null>(null);
  const [bar, setBar] = useState<{ rect: DOMRect; active: Set<string> } | null>(null);
  const history = useRef<{ stack: Array<{ v: string; c: number }>; at: number; last: number }>({ stack: [{ v: value, c: value.length }], at: 0, last: 0 });

  const render = (v: string) => {
    root.current!.replaceChildren(...build(v));
    shown.current = v;
    colourLater(v);
  };
  /** Code blocks colour once highlight.js has loaded. */
  const colourLater = (v: string) => {
    if (!hljsReady() && findFences(v).some((f) => f.lang)) void loadHljs().then(() => refresh());
  };
  /** Redraws the current value in place, keeping the selection. */
  const refresh = () => {
    const el = root.current;
    const v = shown.current;
    if (!el || v === null) return;
    const focused = document.activeElement === el;
    const [a, b] = focused ? getSelection() : [0, 0];
    const next = build(v);
    const probe = document.createElement('div');
    probe.append(...next);
    colourLater(v);
    if (probe.innerHTML === el.innerHTML) return;
    el.replaceChildren(...probe.childNodes);
    if (focused) selectRange(a, b);
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
    range.setStart(...positionOf(el, pos));
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
  const selectRange = (a: number, b: number) => {
    setCaret(b);
    if (a === b) return;
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
  };
  const restore = () => {
    const el = root.current;
    if (!el || document.activeElement === el) return;
    el.focus();
    const [a, b] = saved.current ?? [shown.current?.length ?? 0, shown.current?.length ?? 0];
    selectRange(a, b);
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

  /** Wraps the selection in a markdown marker, or unwraps it when it is already wrapped. */
  const format = (marker: string) => {
    restore();
    const cur = shown.current ?? '';
    const [s, e] = getSelection();
    const m = marker.length;
    let next: string;
    let a: number;
    let b: number;
    if (wrappedOutside(cur, s, e, marker)) {
      next = cur.slice(0, s - m) + cur.slice(s, e) + cur.slice(e + m);
      [a, b] = [s - m, e - m];
    } else if (wrappedInside(cur, s, e, marker)) {
      next = cur.slice(0, s) + cur.slice(s + m, e - m) + cur.slice(e);
      [a, b] = [s, e - 2 * m];
    } else {
      next = cur.slice(0, s) + marker + cur.slice(s, e) + marker + cur.slice(e);
      [a, b] = [s + m, e + m];
    }
    render(next);
    selectRange(a, b);
    commit(next, b);
  };
  /** Quotes (or unquotes) every line the selection touches. */
  const quote = () => {
    restore();
    const cur = shown.current ?? '';
    const [s, e] = getSelection();
    const start = cur.lastIndexOf('\n', s - 1) + 1;
    const found = cur.indexOf('\n', e);
    const end = found < 0 ? cur.length : found;
    const lines = cur.slice(start, end).split('\n');
    const quoted = lines.every((l) => l.startsWith('> '));
    const block = lines.map((l) => (quoted ? l.slice(2) : l.startsWith('> ') ? l : `> ${l}`)).join('\n');
    const next = cur.slice(0, start) + block + cur.slice(end);
    render(next);
    selectRange(start, start + block.length);
    commit(next, start + block.length);
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

  // Remember where the caret was whenever the selection moves inside the editor, and show the
  // formatting menu over a selection.
  useEffect(() => {
    const track = () => {
      const el = root.current;
      const sel = window.getSelection();
      const inside = !!(el && sel?.rangeCount && el.contains(sel.anchorNode));
      if (inside) saved.current = getSelection();
      if (!formatting) return;
      if (!inside || sel!.isCollapsed || document.activeElement !== el) return setBar(null);
      const [s, e] = saved.current!;
      const cur = shown.current ?? '';
      setBar({
        rect: sel!.getRangeAt(0).getBoundingClientRect(),
        active: new Set(MARKERS.filter((m) => wrappedOutside(cur, s, e, m) || wrappedInside(cur, s, e, m))),
      });
    };
    document.addEventListener('selectionchange', track);
    window.addEventListener('scroll', track, true);
    window.addEventListener('resize', track);
    return () => {
      document.removeEventListener('selectionchange', track);
      window.removeEventListener('scroll', track, true);
      window.removeEventListener('resize', track);
    };
  }, [formatting]);

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
    const v = serializeRoot(el);
    const [, caret] = getSelection();
    // Redraw only when the browser's DOM differs from ours (new emoji, a mark opened or closed,
    // pasted spans, the <br> left in an emptied box), so plain typing keeps its native caret.
    shown.current = v;
    refresh();
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
        onBlur={() => setBar(null)}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          const shortcut = mod && !e.shiftKey && !e.altKey ? SHORTCUTS[e.key.toLowerCase()] : undefined;
          if (shortcut) {
            e.preventDefault();
            format(shortcut);
            return;
          }
          // Inside a ``` block, Enter is a new line rather than send.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && inCodeBlock(shown.current ?? '', getSelection()[0])) {
            e.preventDefault();
            insert('\n');
            return;
          }
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
      {bar &&
        createPortal(
          <div
            role="toolbar"
            aria-label="Text formatting"
            // Keep the selection while clicking.
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-line bg-overlay p-1 shadow-lg"
            style={{ top: bar.rect.top - 8, left: bar.rect.left + bar.rect.width / 2 }}
          >
            {TOOLS.map((t, i) =>
              t === null ? (
                <span key={i} aria-hidden className="mx-1 h-5 w-px bg-line" />
              ) : (
                <button
                  key={t.label}
                  type="button"
                  aria-label={t.label}
                  aria-pressed={t.marker ? bar.active.has(t.marker) : undefined}
                  title={t.label}
                  onClick={() => (t.marker ? format(t.marker) : quote())}
                  className={clsx(
                    'grid h-8 w-8 place-items-center rounded-sm transition-colors hover:bg-hover hover:text-fg',
                    t.marker && bar.active.has(t.marker) ? 'text-brand-sky' : 'text-fg-muted'
                  )}
                >
                  <t.icon size={18} strokeWidth={2.25} />
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </div>
  );
});
