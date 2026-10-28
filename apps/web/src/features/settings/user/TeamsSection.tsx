import { useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { DEV_TEAM_ROLES, DEV_TEAM_ROLE_INFO, appRoleAtLeast, type AppRole, type DevTeamRole } from '@subspace/constants';
import { http } from '../../../lib/http';
import { confirmAction, toast } from '../../../app/ui';
import { useStore } from '../../../data/store';
import { Avatar } from '../../common/Avatar';

export interface Team {
  id: string;
  name: string;
  owner: { id: string; username: string; discriminator: string; displayName: string; avatarUrl: string | null };
  myRole: AppRole | null;
  members: Array<{ id: string; username: string; discriminator: string; displayName: string; avatarUrl: string | null; role: DevTeamRole; pending: boolean }>;
  applications: Array<{ id: string; name: string; iconUrl: string | null }>;
}

export interface Invitation {
  teamId: string;
  name: string;
  role: DevTeamRole;
  owner: string;
}

const select = 'h-8 rounded-md border border-line bg-void px-2 text-sm text-fg';

function TeamCard({ team, onChange, onGone }: { team: Team; onChange: (t: Team) => void; onGone: () => void }) {
  const meId = useStore((s) => s.me?.id);
  const [invitee, setInvitee] = useState('');
  const [role, setRole] = useState<DevTeamRole>('developer');
  const admin = appRoleAtLeast(team.myRole, 'admin');
  const owner = team.myRole === 'owner';
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const [username, discriminator] = invitee.trim().split('#');
    if (!username || !/^\d{4}$/.test(discriminator ?? '')) return toast('Enter their name like name#1234', 'error');
    void run(async () => {
      onChange((await http.post<{ team: Team }>(`/teams/${team.id}/members`, { username, discriminator, role })).team);
      setInvitee('');
      toast(`Invited ${username}: they join when they accept`, 'success');
    });
  };

  return (
    <li aria-label={team.name} className="rounded-lg bg-raised p-4 ring-1 ring-line">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand-sky">
          <Users className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-fg">{team.name}</span>
          <span className="block text-xs text-fg-muted">
            {owner ? 'You own it' : `Owned by ${team.owner.username} · you are ${team.myRole ? DEV_TEAM_ROLE_INFO[team.myRole as DevTeamRole]?.label ?? team.myRole : 'invited'}`} ·{' '}
            {team.applications.length} {team.applications.length === 1 ? 'application' : 'applications'}
          </span>
        </span>
        {owner ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              confirmAction({
                title: `Delete ${team.name}`,
                body: 'Its applications stay yours. Members lose access to them.',
                confirmLabel: 'Delete Team',
                danger: true,
                onConfirm: async () => {
                  await http.delete(`/teams/${team.id}`);
                  onGone();
                },
              })
            }
          >
            Delete Team
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              confirmAction({
                title: `Leave ${team.name}`,
                body: 'You lose access to its applications.',
                confirmLabel: 'Leave',
                danger: true,
                onConfirm: async () => {
                  await http.delete(`/teams/${team.id}/members/${meId}`);
                  onGone();
                },
              })
            }
          >
            Leave
          </Button>
        )}
      </div>

      <ul aria-label={`${team.name} members`} className="mt-3 divide-y divide-line">
        <li className="flex items-center gap-3 py-2">
          <Avatar user={team.owner as any} size={28} decoration={false} />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{team.owner.displayName || team.owner.username}</span>
          <span className="text-xs font-semibold text-fg-muted">Owner</span>
        </li>
        {team.members.map((m) => {
          // Admins manage developers and read-only members; only the owner manages admins.
          const manageable = admin && (owner || m.role !== 'admin');
          return (
            <li key={m.id} aria-label={m.username} className="flex items-center gap-3 py-2">
              <Avatar user={m as any} size={28} decoration={false} />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {m.displayName || m.username}
                {m.pending && <span className="ml-2 text-xs text-fg-subtle">invited</span>}
              </span>
              {manageable ? (
                <select
                  aria-label={`Role for ${m.username}`}
                  className={select}
                  value={m.role}
                  onChange={(e) => void run(async () => onChange((await http.patch<{ team: Team }>(`/teams/${team.id}/members/${m.id}`, { role: e.target.value })).team))}
                >
                  {DEV_TEAM_ROLES.filter((r) => owner || r !== 'admin').map((r) => (
                    <option key={r} value={r}>
                      {DEV_TEAM_ROLE_INFO[r].label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-semibold text-fg-muted">{DEV_TEAM_ROLE_INFO[m.role].label}</span>
              )}
              {manageable && (
                <button
                  type="button"
                  className="text-xs text-danger hover:underline"
                  onClick={() =>
                    void run(async () => {
                      await http.delete(`/teams/${team.id}/members/${m.id}`);
                      onChange({ ...team, members: team.members.filter((x) => x.id !== m.id) });
                    })
                  }
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {admin && (
        <form onSubmit={invite} aria-label={`Invite to ${team.name}`} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input label="Invite someone" placeholder="name#1234" value={invitee} onChange={(e) => setInvitee(e.target.value)} />
          </div>
          <select aria-label="Role" className={`${select} h-10`} value={role} onChange={(e) => setRole(e.target.value as DevTeamRole)}>
            {DEV_TEAM_ROLES.filter((r) => owner || r !== 'admin').map((r) => (
              <option key={r} value={r} title={DEV_TEAM_ROLE_INFO[r].description}>
                {DEV_TEAM_ROLE_INFO[r].label}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!invitee.trim()}>
            Invite
          </Button>
        </form>
      )}
    </li>
  );
}

/**
 * Development teams (Discord's): share applications with other people, each with a role. Lives in
 * User Settings › Developer Applications.
 */
export function TeamsSection({ teams, invitations, onTeams, onInvitations, canCreate }: {
  teams: Team[];
  invitations: Invitation[];
  onTeams: (t: Team[]) => void;
  onInvitations: (i: Invitation[]) => void;
  canCreate: boolean;
}) {
  const meId = useStore((s) => s.me?.id);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await http.post<{ team: Team }>('/teams', { name: name.trim() });
      onTeams([...teams, r.team]);
      setCreating(false);
      setName('');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const answer = async (inv: Invitation, accept: boolean) => {
    try {
      if (accept) {
        const r = await http.post<{ team: Team }>(`/teams/${inv.teamId}/accept`);
        onTeams([...teams, r.team]);
      } else {
        await http.delete(`/teams/${inv.teamId}/members/${meId}`);
      }
      onInvitations(invitations.filter((i) => i.teamId !== inv.teamId));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <section aria-label="Teams" className="mt-8">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 text-base font-semibold text-fg">Teams</h3>
        <Button size="sm" variant="secondary" disabled={!canCreate} onClick={() => setCreating(true)}>
          New Team
        </Button>
      </div>
      <p className="mt-1 text-sm text-fg-muted">Work on applications together. Move an application into a team from its card above; members reach it as their role allows.</p>

      {invitations.length > 0 && (
        <ul aria-label="Team invitations" className="mt-3 space-y-2">
          {invitations.map((inv) => (
            <li key={inv.teamId} className="flex items-center gap-3 rounded-lg bg-brand-soft/40 p-3 ring-1 ring-brand/30">
              <span className="min-w-0 flex-1 text-sm text-fg">
                <strong>{inv.owner}</strong> invited you to <strong>{inv.name}</strong> as {DEV_TEAM_ROLE_INFO[inv.role].label}.
              </span>
              <Button size="sm" onClick={() => void answer(inv, true)}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void answer(inv, false)}>
                Decline
              </Button>
            </li>
          ))}
        </ul>
      )}

      {teams.length > 0 && (
        <ul aria-label="Your teams" className="mt-3 space-y-3">
          {teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              onChange={(next) => onTeams(teams.map((x) => (x.id === next.id ? next : x)))}
              onGone={() => onTeams(teams.filter((x) => x.id !== t.id))}
            />
          ))}
        </ul>
      )}

      {creating && (
        <Modal isOpen onClose={() => setCreating(false)} title="Create a Team" maxWidth="md">
          <form onSubmit={create} className="space-y-4">
            <Input label="Team name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus required />
            <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
              <Button variant="link" className="text-fg" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={name.trim().length < 2}>
                Create
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
