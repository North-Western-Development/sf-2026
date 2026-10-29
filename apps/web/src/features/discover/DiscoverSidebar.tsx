import { Link, useSearchParams } from 'react-router';
import { clsx } from 'clsx';
import { DISCOVER_HOME, DISCOVERY_CATEGORIES } from './categories';

/** Discover's sidebar (Discord's): Home, then one entry per category. */
export function DiscoverSidebar() {
  const [params] = useSearchParams();
  const current = params.get('category');
  const items = [{ id: null, label: DISCOVER_HOME.label, icon: DISCOVER_HOME.icon }, ...DISCOVERY_CATEGORIES];
  return (
    <div className="flex h-full flex-col">
      <h2 className="flex h-12 shrink-0 items-center border-b border-line px-4 text-lg font-bold text-fg shadow-sm">Discover</h2>
      <nav aria-label="Discover categories" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ id, label, icon: Icon }) => {
          const active = id === current;
          return (
            <Link
              key={id ?? 'home'}
              to={id ? `/discover?category=${id}` : '/discover'}
              aria-current={active ? 'page' : undefined}
              className={clsx('flex h-10 items-center gap-3 rounded-md px-2 text-[15px] font-medium', active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
