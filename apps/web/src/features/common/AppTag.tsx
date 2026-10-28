import { Check } from 'lucide-react';
import { Tooltip } from '@subspace/ui';
import { clsx } from 'clsx';
import type { UserRef } from '../../lib/types';
import { term } from '../../lib/strings';

/**
 * Discord's APP tag, on posts and in the member list of accounts that are not people: a bot's
 * APP (with a check once staff verified it, so it cannot be impersonated), a webhook's HOOK, and
 * BEACON on an announcement published by a beacon this relay follows.
 */
export function AppTag({ user, crosspost, className }: { user: Pick<UserRef, 'botKind' | 'botVerified'>; crosspost?: boolean; className?: string }) {
  if (!user.botKind) return null;
  const [label, tip] = crosspost
    ? [term('beacon'), `Published by a ${term('beacon').toLowerCase()} this relay follows`]
    : user.botKind === 'webhook'
      ? ['Hook', 'Posted by a webhook']
      : user.botVerified
        ? ['App', 'Verified app: instance staff confirmed who made it']
        : ['App', 'An application (bot)'];
  return (
    <Tooltip content={tip}>
      <span
        data-testid="app-tag"
        className={clsx('inline-flex h-4 items-center gap-0.5 rounded-xs bg-brand px-1 text-[10px] font-bold uppercase leading-4 text-on-brand', className)}
      >
        {user.botKind === 'bot' && user.botVerified && !crosspost && <Check className="h-2.5 w-2.5" strokeWidth={4} aria-label="Verified" />}
        {label}
      </span>
    </Tooltip>
  );
}
