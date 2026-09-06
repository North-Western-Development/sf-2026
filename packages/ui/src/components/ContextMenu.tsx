import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Check } from 'lucide-react';

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
  children?: ContextMenuItem[];
  onClick?: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [coords, setCoords] = useState({ x, y });

  // Boundary clamping for main menu
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const padding = 12;
      let adjustedX = x;
      let adjustedY = y;

      if (adjustedX + rect.width > window.innerWidth - padding) {
        adjustedX = window.innerWidth - rect.width - padding;
      }
      if (adjustedY + rect.height > window.innerHeight - padding) {
        if (y - rect.height - padding > 0) {
          adjustedY = y - rect.height - 8;
        } else {
          adjustedY = window.innerHeight - rect.height - padding;
        }
      }

      setCoords({
        x: Math.max(padding, adjustedX),
        y: Math.max(padding, adjustedY),
      });
    }
  }, [x, y, items]);

  // Global dismiss on click outside or escape key
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[9999] min-w-[210px] bg-[#0E1118] border border-[#232936] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] p-1.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none text-left"
      style={{ left: `${coords.x}px`, top: `${coords.y}px` }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return (
            <div
              key={item.id || `sep-${index}`}
              className="h-[1px] bg-[#232936] my-1 mx-1.5"
            />
          );
        }

        const itemId = item.id || item.label || `item-${index}`;
        const isSubmenuOpen = activeSubmenuId === itemId;
        const hasChildren = Boolean(item.children && item.children.length > 0);

        return (
          <div
            key={itemId}
            className="relative"
            onMouseEnter={() => {
              if (hasChildren) {
                setActiveSubmenuId(itemId);
              } else {
                setActiveSubmenuId(null);
              }
            }}
          >
            <button
              type="button"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                if (hasChildren) {
                  setActiveSubmenuId(prev => prev === itemId ? null : itemId);
                  return;
                }
                if (item.onClick) {
                  item.onClick();
                  onClose();
                }
              }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all group ${
                item.disabled
                  ? 'opacity-40 cursor-not-allowed text-[#64748B]'
                  : item.danger
                  ? 'text-[#FF3366] hover:bg-[#FF3366]/15 hover:text-[#FF4D7D]'
                  : isSubmenuOpen
                  ? 'bg-[#1F2533] text-[#F0F4F8]'
                  : 'text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1A202C]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {item.icon && (
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center opacity-80 group-hover:opacity-100">
                    {item.icon}
                  </span>
                )}
                <div className="min-w-0 text-left">
                  <div className="truncate">{item.label}</div>
                  {item.sublabel && (
                    <div className="text-[10px] text-[#64748B] font-normal truncate">
                      {item.sublabel}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                {item.checked !== undefined && (
                  <span className="w-4 h-4 rounded bg-[#00F0FF]/20 border border-[#00F0FF]/40 flex items-center justify-center text-[#00F0FF]">
                    {item.checked && <Check className="w-3 h-3" />}
                  </span>
                )}
                {item.shortcut && (
                  <span className="text-[10px] font-mono text-[#64748B] group-hover:text-[#94A3B8]">
                    {item.shortcut}
                  </span>
                )}
                {hasChildren && (
                  <ChevronRight className="w-3.5 h-3.5 text-[#64748B] group-hover:text-[#F0F4F8]" />
                )}
              </div>
            </button>

            {/* Nested Submenu */}
            {hasChildren && isSubmenuOpen && item.children && (
              <Submenu items={item.children} onClose={onClose} />
            )}
          </div>
        );
      })}
    </div>
  );
};

const Submenu: React.FC<{ items: ContextMenuItem[]; onClose: () => void }> = ({
  items,
  onClose,
}) => {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [placementLeft, setPlacementLeft] = useState(false);

  useEffect(() => {
    if (submenuRef.current) {
      const rect = submenuRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 10) {
        setPlacementLeft(true);
      }
    }
  }, []);

  return (
    <div
      ref={submenuRef}
      className={`absolute top-0 min-w-[200px] bg-[#0E1118] border border-[#232936] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.9)] p-1.5 backdrop-blur-md animate-in fade-in duration-100 select-none z-50 ${
        placementLeft ? 'right-full mr-1' : 'left-full ml-1'
      }`}
    >
      {items.map((sub, idx) => {
        if (sub.separator) {
          return (
            <div
              key={sub.id || `sub-sep-${idx}`}
              className="h-[1px] bg-[#232936] my-1 mx-1.5"
            />
          );
        }
        return (
          <button
            key={sub.id || `sub-${idx}`}
            type="button"
            disabled={sub.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (sub.disabled) return;
              if (sub.onClick) {
                sub.onClick();
                onClose();
              }
            }}
            className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all group ${
              sub.disabled
                ? 'opacity-40 cursor-not-allowed text-[#64748B]'
                : sub.danger
                ? 'text-[#FF3366] hover:bg-[#FF3366]/15 hover:text-[#FF4D7D]'
                : 'text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1A202C]'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {sub.icon && (
                <span className="w-4 h-4 shrink-0 flex items-center justify-center opacity-80 group-hover:opacity-100">
                  {sub.icon}
                </span>
              )}
              <span className="truncate text-left">{sub.label}</span>
            </div>
            {sub.checked !== undefined && (
              <span className="w-4 h-4 rounded bg-[#00F0FF]/20 border border-[#00F0FF]/40 flex items-center justify-center text-[#00F0FF]">
                {sub.checked && <Check className="w-3 h-3" />}
              </span>
            )}
            {sub.shortcut && (
              <span className="text-[10px] font-mono text-[#64748B] group-hover:text-[#94A3B8]">
                {sub.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

// React Context & Provider for ergonomic application-wide custom context menus
interface ContextMenuContextType {
  openContextMenu: (
    event: React.MouseEvent | { clientX: number; clientY: number },
    items: ContextMenuItem[]
  ) => void;
  closeContextMenu: () => void;
}

const ContextMenuContext = React.createContext<ContextMenuContextType>({
  openContextMenu: () => {},
  closeContextMenu: () => {},
});

export const useContextMenu = () => React.useContext(ContextMenuContext);

export interface ContextMenuProviderProps {
  children: React.ReactNode;
  fallbackItems?: ContextMenuItem[];
}

export const ContextMenuProvider: React.FC<ContextMenuProviderProps> = ({
  children,
  fallbackItems,
}) => {
  const [menuState, setMenuState] = useState<{
    isOpen: boolean;
    items: ContextMenuItem[];
    x: number;
    y: number;
  }>({
    isOpen: false,
    items: [],
    x: 0,
    y: 0,
  });

  const openContextMenu = (
    event: React.MouseEvent | { clientX: number; clientY: number },
    items: ContextMenuItem[]
  ) => {
    if ('preventDefault' in event && typeof event.preventDefault === 'function') {
      event.preventDefault();
      event.stopPropagation();
    }
    let targetX = event.clientX;
    let targetY = event.clientY;

    if ((!targetX && !targetY) && 'currentTarget' in event && event.currentTarget) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect?.();
      if (rect) {
        targetX = rect.left;
        targetY = rect.top;
      }
    }

    setMenuState({
      isOpen: true,
      items,
      x: targetX || 0,
      y: targetY || 0,
    });
  };

  const closeContextMenu = () => {
    setMenuState((prev) => ({ ...prev, isOpen: false }));
  };

  // Permanently intercept and neutralize native browser/OS context menus
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // If a specific element already triggered openContextMenu, menuState will be updated.
      // If no element triggered a custom menu (e.g. user clicked background/blank space),
      // we show the fallbackItems if available, otherwise just suppress.
      if (fallbackItems && fallbackItems.length > 0) {
        setMenuState({
          isOpen: true,
          items: fallbackItems,
          x: e.clientX,
          y: e.clientY,
        });
      }
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
    };
  }, [fallbackItems]);

  return (
    <ContextMenuContext.Provider value={{ openContextMenu, closeContextMenu }}>
      {children}
      {menuState.isOpen && (
        <ContextMenu
          items={menuState.items}
          x={menuState.x}
          y={menuState.y}
          onClose={closeContextMenu}
        />
      )}
    </ContextMenuContext.Provider>
  );
};

// Ergonomic wrapper component
export const ContextMenuTrigger: React.FC<{
  items: ContextMenuItem[];
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}> = ({ items, children, className, onClick }) => {
  const { openContextMenu } = useContextMenu();

  return (
    <div
      className={className}
      onClick={onClick}
      onContextMenu={(e) => openContextMenu(e, items)}
    >
      {children}
    </div>
  );
};
