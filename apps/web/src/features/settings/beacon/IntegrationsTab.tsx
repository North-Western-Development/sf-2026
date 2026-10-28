import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Bot, Copy, Megaphone, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { Button, Input } from '@subspace/ui';
import { useStore } from '../../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../../data/permissions';
import { http } from '../../../lib/http';
import { copyText } from '../../../lib/clipboard';
import { term } from '../../../lib/strings';
import { confirmAction, toast } from '../../../app/ui';
import { Dropdown } from '../../common/Dropdown';
import { RelayIcon } from '../../sidebar/BeaconSidebar';
import { AppIcon } from '../user/AppsTabs';
import { invalidateAppCommands } from '../../chat/appCommands';
import { SettingsTitle, SettingsSection, Field, RowButton } from '../SettingsLayout';

interface Webhook {
  id: string;
  relayId: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  /** Only right after creating it or resetting its URL. */
  url?: string;
  /** A follow: the announcement relay whose published transmissions it posts here. */
  sourceRelayId?: string | null;
}

interface BeaconBot {
  appId: string;
  userId: string;
  name: string;
  iconUrl: string | null;
  description: string | null;
}

const fullUrl = (path: string) => `${window.location.origin}${path}`;

/** A followed announcement relay: what it publishes is posted here. It has no URL; Unfollow removes it. */
function FollowRow({ hook, relays, onDelete }: { hook: Webhook; relays: Array<{ id: string; name: string }>; onDelete: () => void }) {
  const relay = relays.find((r) => r.id === hook.relayId);
  return (
    <li aria-label={`Following ${hook.name}`} className="flex items-center gap-3 rounded-lg bg-raised p-3 ring-1 ring-line">
      {hook.avatarUrl ? <img src={hook.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-on-brand"><Megaphone className="h-5 w-5" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-fg">Following {hook.name}</span>
        <span className="block truncate text-xs text-fg-subtle">
          What it publishes appears in #{relay?.name ?? 'unknown'} · since {new Date(hook.createdAt).toLocaleDateString()}
        </span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          confirmAction({
            title: `Unfollow ${hook.name}`,
            body: 'Nothing new it publishes appears here. What it already published stays.',
            confirmLabel: 'Unfollow',
            danger: true,
            onConfirm: async () => {
              await http.delete(`/webhooks/${hook.id}`);
              onDelete();
            },
          })
        }
      >
        Unfollow
      </Button>
    </li>
  );
}

function WebhookRow({ hook, relays, onChange, onDelete }: { hook: Webhook; relays: Array<{ id: string; name: string; type: string }>; onChange: (w: Webhook) => void; onDelete: () => void }) {
  if (hook.sourceRelayId) return <FollowRow hook={hook} relays={relays} onDelete={onDelete} />;
  return <PlainWebhookRow hook={hook} relays={relays} onChange={onChange} onDelete={onDelete} />;
}

function PlainWebhookRow({ hook, relays, onChange, onDelete }: { hook: Webhook; relays: Array<{ id: string; name: string; type: string }>; onChange: (w: Webhook) => void; onDelete: () => void }) {
  const [name, setName] = useState(hook.name);
  const [avatarUrl, setAvatarUrl] = useState(hook.avatarUrl ?? '');
  const [open, setOpen] = useState(!!hook.url);
  const save = async (body: Partial<Webhook>) => {
    try {
      const r = await http.patch<{ webhook: Webhook }>(`/webhooks/${hook.id}`, body);
      onChange({ ...r.webhook, url: hook.url });
      toast('Webhook saved', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const relay = relays.find((r) => r.id === hook.relayId);
  return (
    <li aria-label={hook.name} className="rounded-lg bg-raised ring-1 ring-line">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left">
        {hook.avatarUrl ? <img src={hook.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-on-brand"><WebhookIcon className="h-5 w-5" /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-fg">{hook.name}</span>
          <span className="block truncate text-xs text-fg-subtle">
            Posts in #{relay?.name ?? 'unknown'} · created {new Date(hook.createdAt).toLocaleDateString()}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <Input aria-label="Webhook name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== hook.name && void save({ name: name.trim() })} />
            </Field>
            <Dropdown
              label={term('relay')}
              value={hook.relayId}
              options={relays.map((r) => ({ value: r.id, label: r.name, icon: <RelayIcon type={r.type as any} /> }))}
              onChange={(v) => v !== hook.relayId && void save({ relayId: v })}
            />
            <Field label="Avatar URL">
              <Input aria-label="Webhook avatar URL" value={avatarUrl} placeholder="https://…" onChange={(e) => setAvatarUrl(e.target.value)} onBlur={() => avatarUrl !== (hook.avatarUrl ?? '') && void save({ avatarUrl: avatarUrl.trim() || null })} />
            </Field>
          </div>
          {hook.url && (
            <Field label="Webhook URL (copy it now: it is shown only once)">
              <div className="flex gap-2">
                <Input aria-label="Webhook URL" data-testid="webhook-url" readOnly value={fullUrl(hook.url)} />
                <RowButton onClick={() => void copyText(fullUrl(hook.url!), 'Webhook URL copied')}>
                  <Copy className="h-4 w-4" />
                </RowButton>
              </div>
            </Field>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                confirmAction({
                  title: 'Reset Webhook URL',
                  body: 'Anything using the old URL stops working.',
                  confirmLabel: 'Reset',
                  danger: true,
                  onConfirm: async () => onChange((await http.post<{ webhook: Webhook }>(`/webhooks/${hook.id}/reset-token`)).webhook),
                })
              }
            >
              {hook.url ? 'Reset URL' : 'Get New URL'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                confirmAction({
                  title: `Delete ${hook.name}`,
                  body: 'Its URL stops working. Transmissions it already posted stay.',
                  confirmLabel: 'Delete Webhook',
                  danger: true,
                  onConfirm: async () => {
                    await http.delete(`/webhooks/${hook.id}`);
                    onDelete();
                  },
                })
              }
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete Webhook
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Discord's Integrations: webhooks that post into relays, and the bots in this beacon. */
export function IntegrationsTab({ beaconId }: { beaconId: string }) {
  const relays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r) => r && ['text', 'archival', 'visual'].includes(r.type))));
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const canHooks = can(perms, PERMISSIONS.MANAGE_WEBHOOKS);
  const canBots = can(perms, PERMISSIONS.MANAGE_BEACON) || can(perms, PERMISSIONS.KICK_MEMBERS);
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [bots, setBots] = useState<BeaconBot[] | null>(null);
  useEffect(() => {
    void http.get<{ webhooks: Webhook[] }>(`/beacons/${beaconId}/webhooks`).then((r) => setHooks(r.webhooks), () => setHooks([]));
    void http.get<{ bots: BeaconBot[] }>(`/beacons/${beaconId}/bots`).then((r) => setBots(r.bots), () => setBots([]));
  }, [beaconId]);

  const create = async () => {
    const relay = relays[0];
    if (!relay) return toast(`Make a text ${term('relay').toLowerCase()} first.`, 'error');
    try {
      const r = await http.post<{ webhook: Webhook }>(`/relays/${relay.id}/webhooks`, { name: `Webhook ${(hooks?.length ?? 0) + 1}` });
      setHooks((list) => [r.webhook, ...(list ?? [])]);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <SettingsTitle>Integrations</SettingsTitle>
      {canHooks && (
        <SettingsSection
          id="webhooks"
          title="Webhooks"
          description={`A webhook is a secret URL that posts into a ${term('relay').toLowerCase()}: point a service (CI, monitoring, a feed) at it. Send JSON { "content": "…", "username": "…", "embeds": [ … ] }.`}
        >
          <Button size="sm" onClick={() => void create()}>
            <WebhookIcon className="mr-1 h-4 w-4" /> New Webhook
          </Button>
          {hooks && hooks.length > 0 && (
            <ul aria-label="Webhooks" className="mt-4 space-y-2">
              {hooks.map((h) => (
                <WebhookRow
                  key={h.id}
                  hook={h}
                  relays={relays}
                  onChange={(next) => setHooks((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)}
                  onDelete={() => setHooks((list) => list?.filter((x) => x.id !== h.id) ?? null)}
                />
              ))}
            </ul>
          )}
          {hooks && !hooks.length && <p className="mt-3 text-sm text-fg-subtle">No webhooks yet.</p>}
        </SettingsSection>
      )}
      <SettingsSection id="bots" title="Bots and Apps" description="Bots added to this beacon. Each has a clearance of its own, named after it, holding what it was given.">
        {bots && bots.length > 0 ? (
          <ul aria-label="Bots" className="space-y-2">
            {bots.map((b) => (
              <li key={b.appId} aria-label={b.name} className="flex items-center gap-3 rounded-lg bg-raised p-3 ring-1 ring-line">
                <AppIcon name={b.name} iconUrl={b.iconUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-fg">{b.name}</span>
                  {b.description && <span className="block truncate text-xs text-fg-subtle">{b.description}</span>}
                </span>
                {canBots && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      confirmAction({
                        title: `Remove ${b.name}`,
                        body: `It leaves the ${term('beacon').toLowerCase()} and its slash commands go with it. It can be added again with its invite link.`,
                        confirmLabel: 'Remove',
                        danger: true,
                        onConfirm: async () => {
                          await http.delete(`/beacons/${beaconId}/bots/${b.appId}`);
                          invalidateAppCommands();
                          setBots((list) => list?.filter((x) => x.appId !== b.appId) ?? null);
                        },
                      })
                    }
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          bots && (
            <p className="flex items-center gap-2 text-sm text-fg-subtle">
              <Bot className="h-4 w-4" /> No bots yet. A bot joins through its developer's invite link.
            </p>
          )
        )}
      </SettingsSection>
    </>
  );
}
