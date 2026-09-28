import { Navigate, useParams } from 'react-router';
import { AtSign, Phone, Users, Video } from 'lucide-react';
import { ComingSoon } from '@subspace/ui';
import { useStore } from '../../data/store';
import { channelKey, type UserRef } from '../../lib/types';
import { userTag } from '../../lib/normalize';
import { term } from '../../lib/strings';
import { ChannelView } from './ChannelView';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { openModal } from '../../app/ui';

function DmProfilePanel({ user }: { user: UserRef }) {
  const status = useStore((s) => s.presence[user.id]?.customStatus?.text);
  return (
    <aside aria-label="Profile" className="w-[340px] shrink-0 overflow-y-auto bg-raised">
      <div className="h-[120px] bg-brand-gradient" />
      <div className="-mt-12 px-4">
        <Avatar user={user} size={92} showPresence ring="var(--color-raised)" className="rounded-full ring-[6px] ring-raised" />
        <div className="mt-3">
          <UserName user={user} className="block text-xl font-bold" />
          <p className="text-sm text-fg-muted">{userTag(user)}</p>
          {status && <p className="mt-2 text-sm text-fg">{status}</p>}
        </div>
        <button
          type="button"
          onClick={() => openModal({ kind: 'profile', userId: user.id })}
          className="mt-4 w-full rounded-md bg-overlay py-2 text-sm font-medium text-fg hover:bg-hover"
        >
          View Full Profile
        </button>
      </div>
    </aside>
  );
}

export function DirectRoute() {
  const { dmId = '' } = useParams();
  const link = useStore((s) => s.links[dmId]);
  const mesh = useStore((s) => s.meshes[dmId]);

  const callActions = (
    <>
      <ComingSoon label="Voice Call" placement="bottom">
        <span className="flex h-8 w-8 items-center justify-center text-fg-muted"><Phone className="h-5 w-5" /></span>
      </ComingSoon>
      <ComingSoon label="Video Call" placement="bottom">
        <span className="flex h-8 w-8 items-center justify-center text-fg-muted"><Video className="h-5 w-5" /></span>
      </ComingSoon>
    </>
  );

  if (link) {
    const u = link.recipient;
    const name = u.displayName || u.username;
    return (
      <ChannelView
        key={link.id}
        channelKey={channelKey('link', link.id)}
        icon={<AtSign className="h-6 w-6" />}
        title={name}
        placeholder={`Transmit to @${name}`}
        actions={callActions}
        aside={<DmProfilePanel user={u} />}
        welcome={
          <div className="mx-4 mb-4 mt-16">
            <Avatar user={u} size={80} />
            <h2 className="mt-2 text-[32px] font-bold leading-tight text-fg">{name}</h2>
            <p className="text-lg text-fg">{userTag(u)}</p>
            <p className="mt-2 text-fg-muted">
              This is the beginning of your {term('link').toLowerCase()} history with <strong>@{name}</strong>.
            </p>
          </div>
        }
      />
    );
  }

  if (mesh) {
    const name = mesh.name || mesh.members.map((m) => m.displayName || m.username).join(', ');
    return (
      <ChannelView
        key={mesh.id}
        channelKey={channelKey('mesh', mesh.id)}
        icon={<Users className="h-6 w-6" />}
        title={name}
        placeholder={`Transmit to ${name}`}
        actions={callActions}
        aside={
          <aside aria-label="Members" className="w-60 shrink-0 overflow-y-auto bg-raised px-2 pb-4">
            <h3 className="px-2 pb-1 pt-6 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Members — {mesh.members.length}</h3>
            {mesh.members.map((m) => (
              <div key={m.id} className="flex h-11 items-center gap-3 rounded-md px-2 hover:bg-hover">
                <Avatar user={m} size={32} showPresence />
                <UserName user={m} className="text-[15px] font-medium" />
                {m.id === mesh.ownerId && <span className="text-xs text-star" aria-label="Mesh owner">★</span>}
              </div>
            ))}
          </aside>
        }
        welcome={
          <div className="mx-4 mb-4 mt-16">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-strong">
              <Users className="h-10 w-10 text-white" />
            </span>
            <h2 className="mt-2 text-[32px] font-bold leading-tight text-fg">{name}</h2>
            <p className="mt-2 text-fg-muted">Welcome to the beginning of the {name} {term('mesh').toLowerCase()}.</p>
          </div>
        }
      />
    );
  }

  return <Navigate to="/channels/@me" replace />;
}
