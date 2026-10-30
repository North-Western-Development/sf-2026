import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { clsx } from 'clsx';

export interface ContextMenuItem {
  id?: string;
  label?: string;
  sublabel?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  /** Section heading (non-interactive). */
  heading?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
  /** Submenus open beside their parent row. */
  isSubmenu?: boolean;
  /** Submenus: left edge of the parent row, used when flipping to the left. */
  flipX?: number;
}

const PADDING = 8;
const interactive = (i: ContextMenuItem) => !i.separator && !i.heading && !i.disabled;

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, x, y, onClose, isSubmenu, flipX }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x, y, ready: false });
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number; flipX: number } | null>(null);

  // Clamp to the viewport; flip upward / leftward when needed.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - PADDING) {
      nx = isSubmenu && flipX !== undefined ? flipX - rect.width - 4 : window.innerWidth - rect.width - PADDING;
    }
    if (ny + rect.height > window.innerHeight - PADDING) {
      ny = Math.max(PADDING, window.innerHeight - rect.height - PADDING);
    }
    setCoords({ x: Math.max(PADDING, nx), y: Math.max(PADDING, ny), ready: true });
  }, [x, y, items, isSubmenu, flipX]);

  useEffect(() => {
    if (!isSubmenu) menuRef.current?.focus();
  }, [isSubmenu]);

  const openSubmenuAt = useCallback((index: number) => {
    const row = menuRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    setSubmenu({ index, x: r.right + 4, y: r.top - 6, flipX: r.left });
  }, []);

  const move = (dir: 1 | -1) => {
    if (!items.some(interactive)) return;
    let next = active;
    do {
      next = (next + dir + items.length) % items.length;
    } while (!interactive(items[next]));
    setActive(next);
  };

  const activate = (index: number) => {
    const item = items[index];
    if (!item || !interactive(item)) return;
    if (item.children?.length) {
      openSubmenuAt(index);
      return;
    }
    item.onClick?.();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(active);
    } else if (e.key === 'ArrowRight' && items[active]?.children?.length) {
      e.preventDefault();
      openSubmenuAt(active);
    } else if (e.key === 'ArrowLeft' && isSubmenu) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-context-menu
      className="fixed z-[2000] min-w-[208px] max-w-[320px] bg-overlay rounded-md shadow-pop p-1.5 select-none text-left outline-none animate-[fade-in_80ms_ease-out]"
      style={{ left: coords.x, top: coords.y, visibility: coords.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, index) => {
        if (item.separator) return <div key={item.id || `sep-${index}`} className="h-px bg-line my-1 mx-1" />;
        if (item.heading) {
          return (
            <div key={item.id || `h-${index}`} className="px-2 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
              {item.label}
            </div>
          );
        }
        const hasChildren = !!item.children?.length;
        const isActive = active === index;
        return (
          <div
            key={item.id || item.label || index}
            data-index={index}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            aria-haspopup={hasChildren || undefined}
            onMouseEnter={() => {
              setActive(index);
              if (hasChildren) openSubmenuAt(index);
              else setSubmenu(null);
            }}
            onClick={(e) => {
              e.stopPropagation();
              activate(index);
            }}
            className={clsx(
              'flex items-center gap-2 px-2 h-8 rounded-xs text-sm cursor-pointer',
              item.disabled && 'opacity-40 cursor-not-allowed',
              !item.disabled && isActive && (item.danger ? 'bg-danger text-white' : 'bg-brand text-on-brand'),
              !item.disabled && !isActive && (item.danger ? 'text-danger' : 'text-fg-muted')
            )}
          >
            <span className="flex-1 min-w-0">
              <span className="block truncate">{item.label}</span>
              {item.sublabel && <span className="block truncate text-[11px] opacity-70">{item.sublabel}</span>}
            </span>
            {item.shortcut && <span className="text-[11px] opacity-60 font-mono">{item.shortcut}</span>}
            {item.checked !== undefined && (
              <span
                className={clsx(
                  'h-4 w-4 rounded-xs border flex items-center justify-center',
                  item.checked ? 'bg-brand border-brand text-on-brand' : 'border-line-strong'
                )}
              >
                {item.checked && <Check className="h-3 w-3" />}
              </span>
            )}
            {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
            {hasChildren && <ChevronRight className="h-4 w-4 shrink-0" />}
          </div>
        );
      })}

      {submenu && items[submenu.index]?.children && (
        <ContextMenu
          isSubmenu
          items={items[submenu.index].children!}
          x={submenu.x}
          y={submenu.y}
          flipX={submenu.flipX}
          onClose={() => {
            setSubmenu(null);
            onClose();
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Phones: the same menu as a sheet from the bottom (Discord's app). Groups between
// separators become rounded cards; a submenu replaces the sheet's contents, with Back.
// ---------------------------------------------------------------------------

/** A phone: touch first and too narrow for a floating menu. */
export const prefersSheet = () => !!window.matchMedia?.('(pointer: coarse) and (max-width: 767px)').matches;

export const ContextSheet: React.FC<{ items: ContextMenuItem[]; onClose: () => void }> = ({ items, onClose }) => {
  const [stack, setStack] = useState<{ title: string; items: ContextMenuItem[] }[]>([]);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const current = stack.length ? stack[stack.length - 1] : null;
  const shown = current?.items ?? items;

  const groups = useMemo(() => {
    const out: ContextMenuItem[][] = [[]];
    for (const item of shown) {
      if (item.separator) out.push([]);
      else out[out.length - 1].push(item);
    }
    return out.filter((g) => g.length);
  }, [shown]);

  const pick = (item: ContextMenuItem) => {
    if (item.disabled) return;
    if (item.children?.length) return setStack((s) => [...s, { title: item.label ?? '', items: item.children! }]);
    item.onClick?.();
    onClose();
  };

  // Drag the handle down to dismiss.
  const handle = {
    onTouchStart: (e: React.TouchEvent) => (start.current = e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => start.current !== null && setDrag(Math.max(0, e.touches[0].clientY - start.current)),
    onTouchEnd: () => {
      start.current = null;
      if (drag > 80) onClose();
      else setDrag(0);
    },
  };

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-[1990] bg-black/60 animate-[fade-in_120ms_ease-out]" />
      <div
        role="menu"
        aria-label={current?.title || 'Actions'}
        data-context-menu
        data-no-swipe
        className="fixed inset-x-0 bottom-0 z-[2000] flex max-h-[80dvh] flex-col rounded-t-2xl bg-base pb-[max(12px,env(safe-area-inset-bottom))] text-left shadow-pop select-none outline-none animate-[sheet-up_180ms_ease-out]"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div {...handle} className="flex shrink-0 flex-col items-center px-4 pt-2 pb-1">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
          {current && (
            <div className="relative mt-2 flex h-9 w-full items-center justify-center">
              <button type="button" aria-label="Back" onClick={() => setStack((s) => s.slice(0, -1))} className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full text-fg-muted">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="truncate px-10 text-[15px] font-semibold text-fg">{current.title}</span>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pt-2">
          {groups.map((group, g) => (
            <div key={g} className="overflow-hidden rounded-xl bg-raised">
              {group.map((item, i) =>
                item.heading ? (
                  <div key={item.id || `h-${i}`} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {item.label}
                  </div>
                ) : (
                  <div
                    key={item.id || item.label || i}
                    role="menuitem"
                    aria-disabled={item.disabled || undefined}
                    aria-haspopup={item.children?.length ? true : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(item);
                    }}
                    className={clsx(
                      'flex min-h-[52px] items-center gap-3 px-4 text-[15px] font-medium active:bg-active',
                      i > 0 && !group[i - 1].heading && 'border-t border-line',
                      item.disabled && 'opacity-40',
                      item.danger ? 'text-danger' : 'text-fg'
                    )}
                  >
                    {item.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center text-fg-muted [&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>}
                    <span className="min-w-0 flex-1 py-2">
                      <span className="block truncate">{item.label}</span>
                      {item.sublabel && <span className="block truncate text-xs font-normal text-fg-muted">{item.sublabel}</span>}
                    </span>
                    {item.checked !== undefined && (
                      <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full border', item.checked ? 'border-brand bg-brand text-on-brand' : 'border-line-strong')}>
                        {item.checked && <Check className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    {item.children?.length ? <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" /> : null}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Provider: the only context menu that ever appears in Subspace.
// ---------------------------------------------------------------------------

interface ContextMenuContextType {
  openContextMenu: (event: React.MouseEvent | { clientX: number; clientY: number }, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;
}

const ContextMenuContext = React.createContext<ContextMenuContextType>({
  openContextMenu: () => {},
  closeContextMenu: () => {},
});

export const useContextMenu = () => React.useContext(ContextMenuContext);

export interface ContextMenuProviderProps {
  children: React.ReactNode;
  /** Shown on right-click where nothing more specific handled the event. */
  fallbackItems?: ContextMenuItem[];
  /** Reads the clipboard for Paste. Defaults to the Clipboard API, which browsers may refuse. */
  readClipboard?: () => Promise<string>;
  /** Called when Paste could not read the clipboard (the field stays focused for Ctrl+V). */
  onPasteBlocked?: () => void;
}

interface ClipboardHooks {
  read: () => Promise<string>;
  blocked?: () => void;
}

const isEditable = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''].includes(el.type);
  }
  return el.isContentEditable;
};

/** Cut / Copy / Paste / Select All for text fields, Copy for selected page text. */
function textActions(target: EventTarget | null, clipboard: ClipboardHooks): ContextMenuItem[] {
  const selection = window.getSelection()?.toString() ?? '';
  if (isEditable(target)) {
    const field = target as HTMLInputElement | HTMLTextAreaElement;
    const isPassword = field instanceof HTMLInputElement && field.type === 'password';
    const hasSelection =
      'selectionStart' in field && field.selectionStart !== null && field.selectionStart !== field.selectionEnd;
    return [
      {
        label: 'Cut',
        shortcut: 'Ctrl+X',
        disabled: !hasSelection || isPassword,
        onClick: () => {
          field.focus();
          document.execCommand('cut');
        },
      },
      {
        label: 'Copy',
        shortcut: 'Ctrl+C',
        disabled: !hasSelection || isPassword,
        onClick: () => {
          field.focus();
          document.execCommand('copy');
        },
      },
      {
        label: 'Paste',
        shortcut: 'Ctrl+V',
        onClick: async () => {
          field.focus();
          let text: string;
          try {
            text = await clipboard.read();
          } catch {
            // Reading the clipboard needs a permission the browser may refuse; Ctrl+V still works.
            clipboard.blocked?.();
            return;
          }
          field.focus();
          document.execCommand('insertText', false, text);
        },
      },
      { separator: true },
      {
        label: 'Select All',
        shortcut: 'Ctrl+A',
        onClick: () => {
          field.focus();
          if ('select' in field) (field as HTMLInputElement).select();
          else document.execCommand('selectAll');
        },
      },
    ];
  }
  if (selection.trim()) {
    return [
      {
        label: 'Copy',
        shortcut: 'Ctrl+C',
        onClick: () => {
          navigator.clipboard?.writeText(selection).catch(() => document.execCommand('copy'));
        },
      },
    ];
  }
  return [];
}

const defaultRead = () => navigator.clipboard.readText();

export const ContextMenuProvider: React.FC<ContextMenuProviderProps> = ({ children, fallbackItems, readClipboard, onPasteBlocked }) => {
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number; sheet?: boolean } | null>(null);
  const handledRef = useRef(false);
  const clipboardRef = useRef<ClipboardHooks>({ read: defaultRead });
  clipboardRef.current = { read: readClipboard ?? defaultRead, blocked: onPasteBlocked };

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const openContextMenu = useCallback<ContextMenuContextType['openContextMenu']>((event, items) => {
    if ('preventDefault' in event && typeof event.preventDefault === 'function') {
      event.preventDefault();
      event.stopPropagation();
    }
    // Specific menus get text actions prepended when the click landed on a field or selection.
    const target = 'target' in event ? (event.target as EventTarget) : null;
    const text = textActions(target, clipboardRef.current);
    const merged = text.length && items.length ? [...text, { separator: true }, ...items] : text.length ? text : items;
    if (!merged.length) return;
    handledRef.current = true;
    queueMicrotask(() => {
      handledRef.current = false;
    });
    let { clientX, clientY } = event;
    if (!clientX && !clientY && 'currentTarget' in event && event.currentTarget) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      clientX = rect.left;
      clientY = rect.bottom;
    }
    const sheet = prefersSheet();
    // The keyboard goes away under a sheet, as in Discord's app.
    if (sheet) (document.activeElement as HTMLElement | null)?.blur?.();
    setMenu({ items: merged, x: clientX, y: clientY, sheet });
  }, []);

  // The browser menu never appears. Unhandled right-clicks get text actions or the fallback.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (handledRef.current) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-context-menu]')) return;
      const text = textActions(e.target, clipboardRef.current);
      const items = text.length ? text : fallbackItems ?? [];
      if (items.length) setMenu({ items, x: e.clientX, y: e.clientY, sheet: prefersSheet() });
      else setMenu(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-context-menu]')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const onBlur = () => setMenu(null);
    // The keyboard closing resizes a phone's window: a sheet stays open through that.
    const onResize = () => setMenu((m) => (m?.sheet ? m : null));
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
    };
  }, [fallbackItems]);

  const value = useMemo(() => ({ openContextMenu, closeContextMenu }), [openContextMenu, closeContextMenu]);

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {menu &&
        createPortal(
          menu.sheet ? <ContextSheet items={menu.items} onClose={closeContextMenu} /> : <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={closeContextMenu} />,
          document.body
        )}
    </ContextMenuContext.Provider>
  );
};

/** Wraps children so right-click opens `items`. */
export const ContextMenuTrigger: React.FC<{
  items: ContextMenuItem[] | (() => ContextMenuItem[]);
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}> = ({ items, children, className, onClick }) => {
  const { openContextMenu } = useContextMenu();
  return (
    <div
      className={className}
      onClick={onClick}
      onContextMenu={(e) => openContextMenu(e, typeof items === 'function' ? items() : items)}
    >
      {children}
    </div>
  );
};
