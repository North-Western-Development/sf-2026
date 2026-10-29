import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Award, CheckCircle2, Code2, Crown, Database, Gamepad2, HardDrive, Lock, LockOpen, Pencil, Rocket, ScrollText, Search, ShieldAlert, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { useStore } from '../../data/store';
import { closeModal, confirmAction, toast } from '../../app/ui';
import { RowButton, SettingsLayout, SettingsSection } from '../settings/SettingsLayout';
import { Avatar } from '../common/Avatar';
import { can, roleOf, type ConsoleMe, type StaffRole, useStaffRoles } from './consoleData';
import { RankPill, RankSelect, StaffRanksTab, StaffTab } from './StaffTabs';
import { BadgesTab, TransmitterBadgesDialog } from './BadgesTab';
import { AuditLogTab } from './AuditLogTab';
import { AppTag } from '../common/AppTag';
import { GamesTab } from './GamesTab';
import { DevelopersTab } from './DevelopersTab';
import { ActivitiesTab } from './ActivitiesTab';
import { BeaconReader, EncryptedContext } from './ReportReview';

type Tab = 'reports' | 'transmitters' | 'vault' | 'groups' | 'badges' | 'developers' | 'games' | 'activities' | 'staff' | 'ranks' | 'log';

interface StorageGroup {
  id: string;
  name: string;
  quotaMb: number;
  maxUploadMb: number;
  members: number;
}

const sizeLabel = (mb: number) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const selectCls = 'h-8 rounded-md bg-void px-2 text-sm normal-case font-normal text-fg outline-none ring-1 ring-line focus:ring-brand';
const actionCls = 'h-8 rounded-md bg-active px-3 text-sm font-medium text-fg transition-colors hover:bg-line-strong';

const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment or abuse',
  spam: 'Spam',
  malware: 'Malicious links or files',
  illicit_content: 'Illegal or prohibited content',
  other: 'Something else',
};

const card = 'rounded-lg bg-raised p-4';
const pill = 'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase';

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-12 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-online" />
      <p className="mt-3 font-semibold text-fg">{title}</p>
      <p className="mt-1 text-sm text-fg-muted">{body}</p>
    </div>
  );
}

function ReportsTab() {
  const [status, setStatus] = useState<'open' | 'all'>('open');
  /** The report whose beacon is open read-only. */
  const [reading, setReading] = useState<string | null>(null);
  const [reports, setReports] = useState<any[] | null>(null);
  const load = useCallback(
    () =>
      http
        .get<{ reports: any[] }>(`/console/reports${status === 'open' ? '?status=open' : ''}`)
        .then((r) => setReports(r.reports))
        .catch((err) => toast((err as Error).message, 'error')),
    [status]
  );
  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (id: string, next: 'resolved' | 'dismissed') => {
    try {
      await http.patch(`/console/reports/${id}`, { status: next, resolutionNotes: `Marked ${next} by staff.` });
      toast(next === 'resolved' ? 'Report resolved.' : 'Report dismissed.', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <SettingsSection title="Reports" description="Reports filed by members, with a snapshot of what was reported.">
      {reading && <BeaconReader reportId={reading} onClose={() => setReading(null)} />}
      <div role="tablist" aria-label="Report status" className="mb-4 flex gap-1">
        {(['open', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={clsx('rounded-md px-2.5 py-1 text-sm font-medium', status === s ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}
          >
            {s === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>
      {reports === null ? (
        <p className="text-sm text-fg-muted">Loading reports…</p>
      ) : reports.length === 0 ? (
        <Empty title="All clear" body={status === 'open' ? 'No reports are waiting for review.' : 'Nobody has filed a report yet.'} />
      ) : (
        <ul aria-label="Reports" className="space-y-3">
          {reports.map(({ report, reporter }) => (
            <li key={report.id} className={card} aria-label={`${REASON_LABELS[report.reason] ?? report.reason} report`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={clsx(pill, report.status === 'open' ? 'bg-danger-soft text-danger' : 'bg-active text-fg-muted')}>{report.status}</span>
                <span className="text-sm font-semibold text-fg">{REASON_LABELS[report.reason] ?? report.reason}</span>
                <span className="text-sm text-fg-muted">· {report.targetType}</span>
                <span className="ml-auto text-xs text-fg-subtle">{new Date(report.createdAt).toLocaleString()}</span>
              </div>
              {report.telemetrySnapshot?.encryptedContext ? (
                <>
                  <p className="mt-3 text-xs text-fg-muted">From an end-to-end encrypted conversation: the reporter shared it in plain text.</p>
                  <EncryptedContext items={report.telemetrySnapshot.encryptedContext} />
                </>
              ) : (
                report.telemetrySnapshot?.transmissionContent && (
                  <blockquote className="mt-3 whitespace-pre-wrap border-l-4 border-line-strong pl-3 text-sm text-fg">{report.telemetrySnapshot.transmissionContent}</blockquote>
                )
              )}
              {report.description && <p className="mt-3 text-sm text-fg">{report.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-fg-muted">
                  Reported by <span className="font-medium text-fg">{reporter?.displayName || reporter?.username || 'unknown'}</span>
                </span>
                {report.status === 'open' && (
                  <span className="ml-auto flex gap-2">
                    {(report.targetType === 'beacon' || report.telemetrySnapshot?.beaconId || report.telemetrySnapshot?.relayId) && (
                      <RowButton onClick={() => setReading(report.id)}>Read Beacon</RowButton>
                    )}
                    <RowButton onClick={() => void resolve(report.id, 'dismissed')}>Dismiss</RowButton>
                    <RowButton danger onClick={() => void resolve(report.id, 'resolved')}>
                      Resolve
                    </RowButton>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function TransmittersTab({ me, meId }: { me: ConsoleMe; meId: string }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<any[] | null>(null);
  const [groups, setGroups] = useState<StorageGroup[]>([]);
  const [badgesFor, setBadgesFor] = useState<any | null>(null);
  const { roles, reload: reloadRoles } = useStaffRoles();
  const storage = can(me, 'MANAGE_STORAGE');
  useEffect(() => {
    if (!storage) return;
    void http.get<{ groups: StorageGroup[] }>('/console/storage-groups').then((r) => setGroups(r.groups), () => {});
  }, [storage]);

  const setRole = async (u: any, roleId: string | null) => {
    try {
      await http.patch(`/console/transmitters/${u.id}/staff-role`, { roleId });
      const role = roles?.find((r) => r.id === roleId);
      toast(role ? `${u.displayName || u.username} is now ${role.name}.` : `${u.displayName || u.username} is no longer staff.`, 'success');
      await Promise.all([load(), reloadRoles()]);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  /** Staff act only on accounts below their own rank. */
  const below = (role: StaffRole | null) => !role || role.position < me.position;
  const setGroup = async (u: any, groupId: string | null) => {
    try {
      await http.patch(`/console/transmitters/${u.id}/storage-group`, { groupId });
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const load = useCallback(
    () =>
      http
        .get<{ transmitters: any[] }>(`/console/transmitters${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ''}`)
        .then((r) => setUsers(r.transmitters))
        .catch((err) => toast((err as Error).message, 'error')),
    [query]
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const toggleBan = (u: any) =>
    confirmAction({
      title: u.isBanned ? 'Lift Suspension' : 'Suspend Transmitter',
      body: u.isBanned
        ? `${u.displayName || u.username} will be able to sign in again.`
        : `${u.displayName || u.username} will be signed out and unable to sign in anywhere on this instance.`,
      confirmLabel: u.isBanned ? 'Lift Suspension' : 'Suspend',
      danger: !u.isBanned,
      onConfirm: async () => {
        await http.post(`/console/transmitters/${u.id}/${u.isBanned ? 'unban' : 'ban'}`, { reason: 'Suspended by instance staff' });
        await load();
      },
    });

  const setVerified = async (u: any, verified: boolean) => {
    try {
      await http.patch(`/console/transmitters/${u.id}/verified`, { verified });
      toast(verified ? `${u.displayName || u.username} is verified.` : `${u.displayName || u.username} is no longer verified.`, 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const toggleQuarantine = (u: any) =>
    confirmAction({
      title: u.quarantinedAt ? 'Lift Quarantine' : 'Quarantine Transmitter',
      body: u.quarantinedAt
        ? `${u.displayName || u.username} will be able to post, DM and join beacons again.`
        : `${u.displayName || u.username} keeps reading, but cannot post or react in beacons, DM anyone new or join beacons. Beacon moderators see it as a signal.`,
      confirmLabel: u.quarantinedAt ? 'Lift Quarantine' : 'Quarantine',
      danger: !u.quarantinedAt,
      onConfirm: async () => {
        await http.post(`/console/transmitters/${u.id}/${u.quarantinedAt ? 'unquarantine' : 'quarantine'}`, { reason: 'Quarantined by instance staff' });
        await load();
      },
    });

  return (
    <SettingsSection title="Transmitters" description="Find accounts on this instance; quarantine or suspend ones that break the Subspace Directives.">
      <label className="mb-4 flex h-9 items-center gap-2 rounded-md bg-void px-3">
        <Search className="h-4 w-4 text-fg-subtle" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by username or display name" aria-label="Search transmitters" className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
      </label>
      {users === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No transmitters match.</p>
      ) : (
        <ul aria-label="Transmitters" className="space-y-2">
          {users.map((u) => {
            const name = u.displayName || u.username;
            const role = roles ? roleOf(roles, u) : null;
            const lower = below(role);
            const canQuarantine = can(me, 'QUARANTINE') && lower;
            const canSuspend = can(me, 'SUSPEND') && lower;
            const showGroup = storage;
            const showRank = !!roles && can(me, 'MANAGE_STAFF') && u.id !== meId && !u.botKind && (me.role.isRoot || lower);
            const showBadges = can(me, 'MANAGE_BADGES');
            // People, and bots (the check on their APP tag); never webhooks.
            const showVerify = can(me, 'MANAGE_DEVELOPERS') && (!u.botKind || u.botKind === 'bot');
            const verifiedBy = [u.isEmailVerified && 'email', u.phoneVerifiedAt && 'phone'].filter(Boolean);
            return (
              <li key={u.id} aria-label={name} className="rounded-lg bg-raised p-3">
                <div className="flex items-start gap-3">
                  <Avatar user={u} size={40} decoration={false} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-semibold text-fg">{name}</span>
                      {role && <RankPill role={role} />}
                      {u.isBanned && <span className={clsx(pill, 'bg-danger-soft text-danger')}>Suspended</span>}
                      {u.quarantinedAt && <span className={clsx(pill, 'bg-warning/15 text-warning')}>Quarantined</span>}
                      {u.botKind && <AppTag user={{ botKind: u.botKind, botVerified: !!u.handVerifiedAt }} />}
                      {u.handVerifiedAt && !u.botKind && <span className={clsx(pill, 'bg-online/15 text-online')}>Verified</span>}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {u.username}
                      {u.discriminator ? `#${u.discriminator}` : ''}
                      <span className="text-fg-subtle"> · Joined {new Date(u.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                      {!u.botKind && <span className="text-fg-subtle"> · {verifiedBy.length ? `Verified ${verifiedBy.join(' and ')}` : 'Email and phone not verified'}</span>}
                    </p>
                  </div>
                  {(canQuarantine || canSuspend || showBadges || showVerify) && (
                    <div className="flex shrink-0 gap-1.5">
                      {showVerify && (
                        <button type="button" onClick={() => void setVerified(u, !u.handVerifiedAt)} aria-label={`${u.handVerifiedAt ? 'Unverify' : 'Verify'} ${u.username}`} className={actionCls}>
                          {u.handVerifiedAt ? 'Unverify' : 'Verify'}
                        </button>
                      )}
                      {showBadges && (
                        <button type="button" onClick={() => setBadgesFor(u)} aria-label={`Badges for ${u.username}`} className={actionCls}>
                          <Award className="h-4 w-4" />
                        </button>
                      )}
                      {canQuarantine && (
                        <button type="button" onClick={() => toggleQuarantine(u)} className={actionCls}>
                          {u.quarantinedAt ? 'Lift Quarantine' : 'Quarantine'}
                        </button>
                      )}
                      {canSuspend && (
                        <button type="button" onClick={() => toggleBan(u)} className={clsx(actionCls, !u.isBanned && 'text-danger hover:bg-danger hover:text-white')}>
                          {u.isBanned ? 'Lift Suspension' : 'Suspend'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {(showGroup || showRank) && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 pl-[52px]">
                    {showGroup && (
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase text-fg-muted">
                        Storage
                        <select aria-label={`Storage group for ${u.username}`} className={selectCls} value={u.storageGroupId ?? ''} onChange={(e) => void setGroup(u, e.target.value || null)}>
                          <option value="">Default</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {showRank && (
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase text-fg-muted">
                        Staff rank
                        <RankSelect me={me} roles={roles!} value={role?.id ?? ''} label={`Staff rank for ${u.username}`} onChange={(id) => void setRole(u, id)} />
                      </label>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {badgesFor && <TransmitterBadgesDialog user={badgesFor} onClose={() => setBadgesFor(null)} />}
    </SettingsSection>
  );
}

function StorageTab() {
  const [files, setFiles] = useState<any[] | null>(null);
  const load = () =>
    http
      .get<{ files: any[] }>('/console/vault/files')
      .then((r) => setFiles(r.files))
      .catch((err) => toast((err as Error).message, 'error'));
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (file: any) => {
    try {
      await http.patch(`/console/vault/files/${file.id}/quarantine`, { isQuarantined: !file.isQuarantined });
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <SettingsSection title="Storage" description="Uploaded files across the instance. Quarantining a file stops it from being served.">
      {files === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : files.length === 0 ? (
        <Empty title="No uploads" body="Nobody has uploaded a file yet." />
      ) : (
        <ul aria-label="Uploaded files" className="divide-y divide-line">
          {files.map(({ file, uploader }) => (
            <li key={file.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                  <span className="truncate">{file.filename}</span>
                  {file.isQuarantined && <span className={clsx(pill, 'bg-danger-soft text-danger')}>Quarantined</span>}
                </p>
                <p className="text-xs text-fg-muted">
                  {uploader?.username ?? 'unknown'} · {(Number(file.sizeBytes) / 1024).toFixed(1)} KB · {file.mimeType}
                </p>
              </div>
              <RowButton danger={!file.isQuarantined} onClick={() => void toggle(file)}>
                <span className="flex items-center gap-1.5">
                  {file.isQuarantined ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  {file.isQuarantined ? 'Release' : 'Quarantine'}
                </span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group: StorageGroup | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [quotaMb, setQuota] = useState(String(group?.quotaMb ?? 1024));
  const [maxUploadMb, setMax] = useState(String(group?.maxUploadMb ?? 100));
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), quotaMb: Number(quotaMb), maxUploadMb: Number(maxUploadMb) };
      if (group) await http.patch(`/console/storage-groups/${group.id}`, body);
      else await http.post('/console/storage-groups', body);
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} title={group ? 'Edit Storage Group' : 'Create Storage Group'} maxWidth="md">
      <form onSubmit={save} className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        <Input label="Storage per member (MB)" type="number" min={1} value={quotaMb} onChange={(e) => setQuota(e.target.value)} required />
        <Input label="Largest upload (MB)" type="number" min={1} value={maxUploadMb} onChange={(e) => setMax(e.target.value)} required />
        <div className="flex justify-end gap-2">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!name.trim() || Number(quotaMb) < 1 || Number(maxUploadMb) < 1}>
            {group ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StorageGroupsTab() {
  const [data, setData] = useState<{ defaults: { quotaMb: number; maxUploadMb: number }; groups: StorageGroup[] } | null>(null);
  const [editing, setEditing] = useState<StorageGroup | 'new' | null>(null);
  const load = useCallback(
    () =>
      http
        .get<{ defaults: { quotaMb: number; maxUploadMb: number }; groups: StorageGroup[] }>('/console/storage-groups')
        .then(setData)
        .catch((err) => toast((err as Error).message, 'error')),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);
  const remove = (g: StorageGroup) =>
    confirmAction({
      title: 'Delete Storage Group',
      body: `${g.members} ${g.members === 1 ? 'member goes' : 'members go'} back to the default storage limits.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/console/storage-groups/${g.id}`);
        await load();
      },
    });
  return (
    <SettingsSection title="Storage Groups" description="Give accounts their own Vault limits. Put someone in a group from the Transmitters page.">
      {data && (
        <p className="mb-4 rounded-md bg-raised px-3 py-2.5 text-sm text-fg-muted">
          Everyone else gets <span className="font-semibold text-fg">{sizeLabel(data.defaults.quotaMb)}</span> of storage and uploads up to{' '}
          <span className="font-semibold text-fg">{sizeLabel(data.defaults.maxUploadMb)}</span> (DEFAULT_STORAGE_QUOTA_MB and DEFAULT_MAX_UPLOAD_MB).
        </p>
      )}
      <Button size="sm" className="mb-4" onClick={() => setEditing('new')}>
        Create Group
      </Button>
      {data === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : data.groups.length === 0 ? (
        <Empty title="No storage groups" body="Everyone uses the default limits." />
      ) : (
        <ul aria-label="Storage groups" className="divide-y divide-line">
          {data.groups.map((g) => (
            <li key={g.id} aria-label={g.name} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{g.name}</p>
                <p className="text-xs text-fg-muted">
                  {sizeLabel(g.quotaMb)} storage · uploads up to {sizeLabel(g.maxUploadMb)} · {g.members} {g.members === 1 ? 'member' : 'members'}
                </p>
              </div>
              <RowButton onClick={() => setEditing(g)}>
                <span className="flex items-center gap-1.5">
                  <Pencil className="h-4 w-4" /> Edit
                </span>
              </RowButton>
              <RowButton danger onClick={() => remove(g)}>
                <span className="flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4" /> Delete
                </span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
      {editing && <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </SettingsSection>
  );
}

/** Instance staff tools, laid out like the other settings windows. Pages follow the rank's permissions. */
export function ConsoleModal(_props: { staffRank?: number }) {
  const [me, setMe] = useState<ConsoleMe | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const meId = useStore((s) => s.me?.id ?? '');
  useEffect(() => {
    http.get<ConsoleMe>('/console/me').then(setMe, (err) => toast((err as Error).message, 'error'));
  }, []);
  const pages = me
    ? [
        ...(can(me, 'VIEW_REPORTS') ? [{ id: 'reports', icon: <ShieldAlert />, label: 'Reports' }] : []),
        { id: 'transmitters', icon: <Users />, label: 'Transmitters' },
        ...(can(me, 'MANAGE_VAULT') ? [{ id: 'vault', icon: <HardDrive />, label: 'Storage' }] : []),
        ...(can(me, 'MANAGE_STORAGE') ? [{ id: 'groups', icon: <Database />, label: 'Storage Groups' }] : []),
        ...(can(me, 'MANAGE_BADGES') ? [{ id: 'badges', icon: <Award />, label: 'Badges' }] : []),
        ...(can(me, 'MANAGE_DEVELOPERS')
          ? [
              { id: 'developers', icon: <Code2 />, label: 'Developers' },
              { id: 'games', icon: <Gamepad2 />, label: 'Verified Games' },
              { id: 'activities', icon: <Rocket />, label: 'Activities' },
            ]
          : []),
      ]
    : [];
  const team = me
    ? [
        { id: 'staff', icon: <ShieldCheck />, label: 'Staff' },
        ...(can(me, 'MANAGE_STAFF') ? [{ id: 'ranks', icon: <Crown />, label: 'Staff Ranks' }] : []),
        ...(can(me, 'VIEW_AUDIT_LOG') ? [{ id: 'log', icon: <ScrollText />, label: 'Staff Log' }] : []),
      ]
    : [];
  const active = (tab && [...pages, ...team].some((p) => p.id === tab) ? tab : pages[0]?.id) as Tab | undefined;
  return (
    <SettingsLayout
      title="Command Console"
      active={active ?? ''}
      onSelect={(id) => setTab(id as Tab)}
      onClose={closeModal}
      sections={[
        { heading: `Command Console · ${me?.role.name ?? 'Staff'}`, items: pages },
        ...(team.length ? [{ heading: 'Team', items: team }] : []),
      ]}
    >
      {!me && <p className="text-sm text-fg-muted">Loading…</p>}
      {me && active === 'reports' && <ReportsTab />}
      {me && active === 'transmitters' && <TransmittersTab me={me} meId={meId} />}
      {me && active === 'vault' && <StorageTab />}
      {me && active === 'groups' && <StorageGroupsTab />}
      {me && active === 'badges' && <BadgesTab />}
      {me && active === 'developers' && <DevelopersTab />}
      {me && active === 'games' && <GamesTab />}
      {me && active === 'activities' && <ActivitiesTab />}
      {me && active === 'staff' && <StaffTab me={me} />}
      {me && active === 'ranks' && <StaffRanksTab me={me} />}
      {me && active === 'log' && <AuditLogTab />}
    </SettingsLayout>
  );
}
