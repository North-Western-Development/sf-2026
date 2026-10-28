import { useEffect, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { http } from '../../lib/http';
import { confirmAction, toast } from '../../app/ui';
import { RowButton, SettingsSection } from '../settings/SettingsLayout';
import { AppIcon } from '../settings/user/AppsTabs';

interface ReviewedActivity {
  application: { id: string; name: string; iconUrl: string | null; owner: string };
  name: string;
  description: string | null;
  url: string;
  maxParticipants: number;
  approved: boolean;
  updatedAt: string;
}

/**
 * Custom Activities: developers' web pages that run in comm-links. Until approved here only the
 * application's team can launch one; approving lets everyone (each still sees a privacy notice
 * first). A new URL comes back here for review.
 */
export function ActivitiesTab() {
  const [list, setList] = useState<ReviewedActivity[] | null>(null);
  useEffect(() => {
    http.get<{ activities: ReviewedActivity[] }>('/console/activities').then((r) => setList(r.activities), (err) => toast((err as Error).message, 'error'));
  }, []);

  const approve = async (a: ReviewedActivity) => {
    try {
      setList((await http.put<{ activities: ReviewedActivity[] }>(`/console/activities/${a.application.id}/approval`, {})).activities);
      toast(`${a.name} can be launched by everyone`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const withdraw = (a: ReviewedActivity) =>
    confirmAction({
      title: 'Withdraw Approval',
      body: `Only ${a.application.owner}'s team can launch ${a.name} again. Instances already running carry on until their people leave.`,
      confirmLabel: 'Withdraw',
      danger: true,
      onConfirm: async () => setList((await http.delete<{ activities: ReviewedActivity[] }>(`/console/activities/${a.application.id}/approval`)).activities),
    });

  const pending = list?.filter((a) => !a.approved) ?? [];
  const approved = list?.filter((a) => a.approved) ?? [];
  const row = (a: ReviewedActivity) => (
    <li key={a.application.id} aria-label={a.name} className="flex items-center gap-3 py-3">
      <AppIcon name={a.application.name} iconUrl={a.application.iconUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">
          {a.name} <span className="font-normal text-fg-muted">· {a.application.name} · by {a.application.owner}</span>
        </p>
        <p className="truncate font-mono text-xs text-fg-muted">{a.url}</p>
        {a.description && <p className="truncate text-xs text-fg-subtle">{a.description}</p>}
      </div>
      <a href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.name}`} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
        <ExternalLink className="h-4 w-4" />
      </a>
      {a.approved ? (
        <RowButton danger onClick={() => withdraw(a)}>
          <span className="flex items-center gap-1.5">
            <X className="h-4 w-4" /> Withdraw
          </span>
        </RowButton>
      ) : (
        <RowButton onClick={() => void approve(a)}>
          <span className="flex items-center gap-1.5">
            <Check className="h-4 w-4" /> Approve
          </span>
        </RowButton>
      )}
    </li>
  );

  return (
    <SettingsSection
      title="Activities"
      description="Developers' web pages that people open together in comm-links. Approving one lets everyone launch it; until then only its own team can, to test it. Look at what the page does and who runs it first: it sees members' usernames, avatars and IP addresses. A changed URL comes back here."
    >
      {list === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-fg-muted">No developer has added an Activity yet.</p>
      ) : (
        <>
          <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">Waiting for Review · {pending.length}</h3>
          {pending.length ? <ul aria-label="Activities waiting for review" className="mb-6 divide-y divide-line">{pending.map(row)}</ul> : <p className="mb-6 text-sm text-fg-subtle">Nothing to review.</p>}
          <h3 className="mb-1 text-xs font-semibold uppercase text-fg-muted">Approved · {approved.length}</h3>
          {approved.length ? <ul aria-label="Approved activities" className="divide-y divide-line">{approved.map(row)}</ul> : <p className="text-sm text-fg-subtle">None yet.</p>}
        </>
      )}
    </SettingsSection>
  );
}
