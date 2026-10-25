import { useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/** A Discord-style select: the chosen option with its icon, opening a scrollable list below. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  required,
  placeholder = 'Select…',
}: {
  value: T | '';
  options: Array<DropdownOption<T>>;
  onChange: (v: T) => void;
  label: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setFocus(Math.max(0, options.findIndex((o) => o.value === value)));
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.children[focus]?.scrollIntoView({ block: 'nearest' });
  }, [open, focus]);

  const choose = (o: DropdownOption<T>) => {
    onChange(o.value);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setFocus((f) => (f + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      if (options[focus]) choose(options[focus]);
    }
  };

  return (
    <div ref={ref} className="relative">
      <span id={`${id}-label`} className="mb-1.5 block text-sm font-semibold text-fg">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <button
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={clsx('flex h-11 w-full items-center gap-2 rounded-lg bg-void px-3 text-left text-[15px] ring-1', open ? 'ring-brand-sky' : 'ring-line hover:ring-fg-subtle')}
      >
        {current?.icon && <span className="flex shrink-0 text-fg-muted [&>svg]:h-5 [&>svg]:w-5">{current.icon}</span>}
        <span className={clsx('min-w-0 flex-1 truncate', current ? 'text-fg' : 'text-fg-subtle')}>{current?.label ?? placeholder}</span>
        <ChevronDown className={clsx('h-5 w-5 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg bg-overlay p-1 shadow-pop ring-1 ring-line">
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onPointerEnter={() => setFocus(i)}
              onClick={() => choose(o)}
              className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm', i === focus ? 'bg-hover text-fg' : 'text-fg-muted', o.value === value && 'font-semibold text-fg')}
            >
              {o.icon && <span className="flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">{o.icon}</span>}
              <span className="truncate">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
