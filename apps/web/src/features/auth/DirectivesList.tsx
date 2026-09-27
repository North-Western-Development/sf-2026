import { SUBSPACE_DIRECTIVES } from '@subspace/constants';

export function DirectivesList({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? 'space-y-2' : 'space-y-3'}>
      {SUBSPACE_DIRECTIVES.rules.map((rule, i) => (
        <li key={rule.title} className="flex gap-3">
          <span className="shrink-0 mt-0.5 h-5 w-5 rounded-xs bg-star-soft text-star text-[11px] font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <div>
            <p className="text-sm font-medium text-fg">{rule.title}</p>
            {!compact && <p className="text-xs text-fg-muted mt-0.5">{rule.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
