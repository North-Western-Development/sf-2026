import { useEffect, useState, type FormEvent } from 'react';
import { Rocket } from 'lucide-react';
import { Button, Input } from '@subspace/ui';
import { http } from '../../../lib/http';
import { confirmAction, toast } from '../../../app/ui';

interface AppActivity {
  name: string;
  description: string | null;
  url: string;
  maxParticipants: number;
  approved: boolean;
}

/**
 * Developer Applications › Activity: a web page people open together in a comm-link, built with
 * @subspace/activity-sdk. The team can launch it right away to test; everyone else once staff
 * approve it (Command Console › Activities). A new URL needs approving again.
 */
export function ActivitySection({ appId, appName }: { appId: string; appName: string }) {
  const [activity, setActivity] = useState<AppActivity | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', url: '', maxParticipants: '16' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void http.get<{ activity: AppActivity | null }>(`/applications/${appId}/activity`).then(
      (r) => {
        setActivity(r.activity);
        if (r.activity) setForm({ name: r.activity.name, description: r.activity.description ?? '', url: r.activity.url, maxParticipants: String(r.activity.maxParticipants) });
      },
      () => setActivity(null)
    );
  }, [appId]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const moved = !!activity && activity.url !== form.url.trim() && activity.approved;
      const r = await http.put<{ activity: AppActivity }>(`/applications/${appId}/activity`, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        url: form.url.trim(),
        maxParticipants: Math.max(1, Math.min(99, Number(form.maxParticipants) || 16)),
      });
      setActivity(r.activity);
      setAdding(false);
      toast(moved ? 'Activity saved. The new URL needs approving again.' : 'Activity saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (activity === undefined) return null;
  if (!activity && !adding) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-xs font-semibold uppercase text-fg-muted">Activity</p>
        <p className="mt-1 text-sm text-fg-subtle">A web page people open together in a comm-link, built with @subspace/activity-sdk.</p>
        <Button
          size="sm"
          className="mt-2"
          onClick={() => {
            setForm((f) => ({ ...f, name: f.name || appName.slice(0, 32) }));
            setAdding(true);
          }}
        >
          <Rocket className="mr-1 h-4 w-4" /> Add Activity
        </Button>
      </div>
    );
  }
  return (
    <section aria-label="Activity" className="mt-4 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase text-fg-muted">Activity</p>
        {activity && (
          <span data-testid="activity-status" className={activity.approved ? 'text-xs font-semibold text-online' : 'text-xs font-semibold text-warning'}>
            {activity.approved ? 'Approved' : 'Waiting for review: only your team can launch it'}
          </span>
        )}
      </div>
      <form onSubmit={save} aria-label="Activity settings" className="mt-2 grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} maxLength={32} required />
        <Input label="Max Participants" type="number" min={1} max={99} value={form.maxParticipants} onChange={(e) => setForm({ ...form, maxParticipants: e.target.value })} />
        <div className="sm:col-span-2">
          <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
        </div>
        <div className="sm:col-span-2">
          <Input label="Activity URL" placeholder="https://activity.example.com/" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          <p className="mt-1 text-xs text-fg-subtle">
            Your own https page; it loads in a sandboxed frame. Changing it sends the activity back for review. Set Content-Security-Policy frame-ancestors {window.location.origin} on it.
          </p>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button size="sm" type="submit" isLoading={busy}>
            Save Activity
          </Button>
          {activity ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                confirmAction({
                  title: 'Remove Activity',
                  body: 'It disappears from every launcher. Running instances end when their people leave.',
                  confirmLabel: 'Remove',
                  danger: true,
                  onConfirm: async () => {
                    await http.delete(`/applications/${appId}/activity`);
                    setActivity(null);
                  },
                })
              }
            >
              Remove
            </Button>
          ) : (
            <Button size="sm" variant="link" className="text-fg" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
