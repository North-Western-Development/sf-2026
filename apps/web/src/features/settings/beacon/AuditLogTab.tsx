import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { useStore } from '../../../data/store';
import { http } from '../../../lib/http';
import { toUserRef } from '../../../lib/normalize';
import { term } from '../../../lib/strings';
import { formatFullDate } from '../../../lib/time';
import type { UserRef } from '../../../lib/types';
import { Avatar } from '../../common/Avatar';
import { Dropdown } from '../../common/Dropdown';
import { SettingsTitle } from '../SettingsLayout';

interface Entry {
  id: string;
  action: string;
  actor: UserRef | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  changes: Array<{ key: string; old?: unknown; new?: unknown }> | null;
  reason: string | null;
  createdAt: string;
}

/** How each action reads: "<actor> created the relay #name". */
export const ACTION_TEXT: Record<string, string> = {
  beacon_update: `updated the ${term('beacon').toLowerCase()}`,
  relay_create: `created the ${term('relay').toLowerCase()}`,
  relay_update: `updated the ${term('relay').toLowerCase()}`,
  relay_delete: `deleted a ${term('relay').toLowerCase()}`,
  relay_permissions_update: `changed permissions on the ${term('relay').toLowerCase()}`,
  relay_permissions_delete: `removed a permission override from the ${term('relay').toLowerCase()}`,
  clearance_create: `created the ${term('clearance').toLowerCase()}`,
  clearance_update: `updated the ${term('clearance').toLowerCase()}`,
  clearance_delete: `deleted a ${term('clearance').toLowerCase()}`,
  member_clearances_update: `changed the ${term('clearance', true).toLowerCase()} of`,
  member_update: 'updated the member',
  member_timeout: 'changed the timeout of',
  member_kick: 'kicked',
  member_ban: 'banned',
  member_unban: 'unbanned',
  member_prune: 'pruned inactive members',
  glyph_create: `added the ${term('glyph').toLowerCase()}`,
  glyph_update: `renamed a ${term('glyph').toLowerCase()}`,
  glyph_delete: `removed a ${term('glyph').toLowerCase()}`,
  invite_create: 'created the invite',
  invite_delete: 'revoked the invite',
  onboarding_update: 'updated onboarding',
  event_create: 'scheduled the event',
  event_update: 'updated the event',
  event_delete: 'cancelled an event',
  transmission_pin: 'pinned a transmission',
  transmission_unpin: 'unpinned a transmission',
  transmission_delete: 'deleted a transmission in',
  automod_rule_create: 'created the AutoMod rule',
  automod_rule_update: 'updated the AutoMod rule',
  automod_rule_delete: 'deleted the AutoMod rule',
  automod_block: 'blocked a transmission from',
  automod_flag: 'flagged a transmission from',
  sticker_create: 'added the sticker',
  sticker_delete: 'removed a sticker',
  sound_create: 'added the sound',
  sound_delete: 'removed a sound',
  template_create: 'created the template',
  template_sync: 'synced the template',
  template_delete: 'deleted the template',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Row({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const detail = (e.changes?.length ?? 0) > 0 || !!e.reason;
  const name = e.actor?.displayName || e.actor?.username || 'AutoMod';
  return (
    <li className="rounded-lg border border-line bg-raised">
      <button type="button" disabled={!detail} aria-expanded={detail ? open : undefined} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        {e.actor ? <Avatar user={e.actor} size={32} /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-sky">AM</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg-muted">
            <span className="font-semibold text-fg">{name}</span> {ACTION_TEXT[e.action] ?? e.action.replace(/_/g, ' ')}
            {e.targetName && <span className="font-semibold text-fg"> {e.targetType === 'relay' ? `#${e.targetName}` : e.targetName}</span>}
          </span>
          <span className="block text-xs text-fg-subtle">{formatFullDate(e.createdAt)}</span>
        </span>
        {detail && <ChevronDown className={clsx('h-4 w-4 text-fg-muted transition-transform', open && 'rotate-180')} />}
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3 text-sm">
          {e.changes?.map((c) => (
            <p key={c.key} className="text-fg-muted">
              <span className="font-semibold text-fg">{c.key}</span>
              {'old' in c && c.old !== undefined ? <> from <code className="text-fg">{show(c.old)}</code></> : null} to <code className="text-fg">{show(c.new)}</code>
            </p>
          ))}
          {e.reason && <p className="mt-1 text-fg-muted">Reason: <span className="text-fg">{e.reason}</span></p>}
        </div>
      )}
    </li>
  );
}

/** Discord's Audit Log: who changed what, newest first, filterable by member and action. */
export function AuditLogTab({ beaconId }: { beaconId: string }) {
  const members = useStore((s) => s.members[beaconId]);
  const users = useStore((s) => s.users);
  const [actorId, setActorId] = useState('all');
  const [action, setAction] = useState('all');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);

  const load = async (before?: string) => {
    const q = new URLSearchParams({ limit: '50' });
    if (actorId !== 'all') q.set('actorId', actorId);
    if (action !== 'all') q.set('action', action);
    if (before) q.set('before', before);
    const res = await http.get<{ entries: any[] }>(`/beacons/${beaconId}/audit-log?${q}`);
    const page = res.entries.map((e) => ({ ...e, actor: e.actor ? toUserRef(e.actor) : null }));
    setEntries((cur) => (before ? [...(cur ?? []), ...page] : page));
    setMore(page.length === 50);
  };
  useEffect(() => {
    setEntries(null);
    void load().catch(() => setEntries([]));
  }, [beaconId, actorId, action]); // eslint-disable-line react-hooks/exhaustive-deps

  const memberOptions = Object.keys(members ?? {}).map((id) => ({ value: id, label: users[id]?.displayName || users[id]?.username || id }));
  return (
    <>
      <SettingsTitle>Audit Log</SettingsTitle>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Dropdown label="Filter by member" value={actorId} options={[{ value: 'all', label: 'All members' }, ...memberOptions]} onChange={setActorId} />
        <Dropdown
          label="Filter by action"
          value={action}
          options={[{ value: 'all', label: 'All actions' }, ...Object.entries(ACTION_TEXT).map(([value, label]) => ({ value, label: label[0].toUpperCase() + label.slice(1) }))]}
          onChange={setAction}
        />
      </div>
      {entries === null ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-subtle">No logs yet. Changes made in this {term('beacon').toLowerCase()} will show up here.</p>
      ) : (
        <ul aria-label="Audit log entries" className="space-y-2">
          {entries.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </ul>
      )}
      {more && entries && (
        <button type="button" className="mt-4 text-sm font-medium text-brand-sky hover:underline" onClick={() => void load(entries.at(-1)!.createdAt)}>
          Load older entries
        </button>
      )}
    </>
  );
}
