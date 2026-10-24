import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, HardDrive, Lock, LockOpen, Search, ShieldAlert, Users } from 'lucide-react';
import { http } from '../../lib/http';
import { closeModal, confirmAction, toast } from '../../app/ui';
import { RowButton, SettingsLayout, SettingsSection } from '../settings/SettingsLayout';

type Tab = 'reports' | 'transmitters' | 'vault';

const RANK_NAMES = ['Member', 'Moderator', 'Admin', 'Root'];
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
              {report.telemetrySnapshot?.transmissionContent && (
                <blockquote className="mt-3 whitespace-pre-wrap border-l-4 border-line-strong pl-3 text-sm text-fg">{report.telemetrySnapshot.transmissionContent}</blockquote>
              )}
              {report.description && <p className="mt-3 text-sm text-fg">{report.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-fg-muted">
                  Reported by <span className="font-medium text-fg">{reporter?.displayName || reporter?.username || 'unknown'}</span>
                </span>
                {report.status === 'open' && (
                  <span className="ml-auto flex gap-2">
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

function TransmittersTab({ staffRank }: { staffRank: number }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<any[] | null>(null);
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

  return (
    <SettingsSection title="Transmitters" description="Find accounts on this instance and suspend ones that break the Subspace Directives.">
      <label className="mb-4 flex h-9 items-center gap-2 rounded-md bg-void px-3">
        <Search className="h-4 w-4 text-fg-subtle" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by username or display name" aria-label="Search transmitters" className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" />
      </label>
      {users === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No transmitters match.</p>
      ) : (
        <ul aria-label="Transmitters" className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-fg">{u.displayName || u.username}</span>
                  <span className="text-fg-muted">
                    {u.username}
                    {u.discriminator ? `#${u.discriminator}` : ''}
                  </span>
                  {u.staffRank > 0 && <span className={clsx(pill, 'bg-brand/20 text-brand-sky')}>{RANK_NAMES[u.staffRank] ?? `Rank ${u.staffRank}`}</span>}
                  {u.isBanned && <span className={clsx(pill, 'bg-danger-soft text-danger')}>Suspended</span>}
                </p>
                <p className="text-xs text-fg-subtle">Joined {new Date(u.createdAt).toLocaleDateString()}</p>
              </div>
              {staffRank >= 2 && u.staffRank < staffRank && (
                <RowButton danger={!u.isBanned} onClick={() => toggleBan(u)}>
                  {u.isBanned ? 'Lift Suspension' : 'Suspend'}
                </RowButton>
              )}
            </li>
          ))}
        </ul>
      )}
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

/** Instance staff tools, laid out like the other settings windows. */
export function ConsoleModal({ staffRank }: { staffRank: number }) {
  const [tab, setTab] = useState<Tab>('reports');
  return (
    <SettingsLayout
      title="Command Console"
      active={tab}
      onSelect={(id) => setTab(id as Tab)}
      onClose={closeModal}
      sections={[
        {
          heading: `Command Console · ${RANK_NAMES[staffRank] ?? 'Staff'}`,
          items: [
            { id: 'reports', icon: <ShieldAlert />, label: 'Reports' },
            { id: 'transmitters', icon: <Users />, label: 'Transmitters' },
            { id: 'vault', icon: <HardDrive />, label: 'Storage' },
          ],
        },
      ]}
    >
      {tab === 'reports' && <ReportsTab />}
      {tab === 'transmitters' && <TransmittersTab staffRank={staffRank} />}
      {tab === 'vault' && <StorageTab />}
    </SettingsLayout>
  );
}
