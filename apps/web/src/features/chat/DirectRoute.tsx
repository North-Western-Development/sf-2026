import { Navigate, useParams } from 'react-router';
import { AtSign, Lock, Users } from 'lucide-react';
import { useStore } from '../../data/store';
import { channelKey, type UserRef } from '../../lib/types';
import { userTag } from '../../lib/normalize';
import { term } from '../../lib/strings';
import { ChannelView } from './ChannelView';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { openModal } from '../../app/ui';
import { CallButtons, CallPanel } from '../voice/DmCall';
import { EncryptionButton, MeshEncryptionButton } from './EncryptionControls';
import { ProfileGameActivity } from '../activity/ActivityViews';
import { NotebookPen } from 'lucide-react';
import { Tooltip } from '@subspace/ui';
import { useProfile, type FullProfile } from '../profile/useProfile';
import { ProfileNote, noteBoxNear } from '../profile/ProfileParts';
import { useChatPrefs } from '../../lib/chatPrefs';

function DmProfilePanel({ user }: { user: UserRef }) {
  const status = useStore((s) => s.presence[user.id]?.customStatus?.text);
  const profile = useProfile(user.id) as FullProfile | null;
  const showNote = useChatPrefs((p) => p.notesInProfilePanel) && !user.botKind;
  return (
    <aside aria-label="Profile" className="w-[340px] shrink-0 overflow-y-auto bg-raised">
      <div className="h-[120px] bg-brand-gradient" />
      <div className="-mt-12 px-4">
        <Avatar user={user} size={92} showPresence ring="var(--color-raised)" className="rounded-full ring-[6px] ring-raised" />
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <UserName user={user} className="block text-xl font-bold" />
            {!user.botKind && (
              <Tooltip content={profile?.note ? 'Edit Note (only visible to you)' : 'Add Note (only visible to you)'}>
                <button
                  type="button"
                  aria-label={profile?.note ? 'Edit Note' : 'Add Note'}
                  onClick={(e) => {
                    // The note box is at the bottom; with it hidden, the full profile has one.
                    const box = noteBoxNear(e.currentTarget, user.id);
                    if (box) box.focus();
                    else openModal({ kind: 'profile', userId: user.id });
                  }}
                  className="rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <NotebookPen className="h-4 w-4" aria-hidden />
                </button>
              </Tooltip>
            )}
          </div>
          <p className="text-sm text-fg-muted">{userTag(user)}</p>
          {status && (
            <p title={status} className="mt-2 line-clamp-2 text-sm text-fg [overflow-wrap:anywhere] hover:line-clamp-none">
              {status}
            </p>
          )}
        </div>
        <div className="mt-4 empty:hidden">
          <ProfileGameActivity userId={user.id} />
        </div>
        <button
          type="button"
          onClick={() => openModal({ kind: 'profile', userId: user.id })}
          className="mt-4 w-full rounded-md bg-overlay py-2 text-sm font-medium text-fg hover:bg-hover"
        >
          View Full Profile
        </button>
        {showNote && profile && (
          <div className="mb-4 mt-4 border-t border-line pt-3">
            <ProfileNote userId={user.id} initial={profile.note} maxLength={profile.noteMaxLength} />
          </div>
        )}
      </div>
    </aside>
  );
}

export function DirectRoute() {
  const { dmId = '' } = useParams();
  const link = useStore((s) => s.links[dmId]);
  const mesh = useStore((s) => s.meshes[dmId]);


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
        actions={
          <>
            <EncryptionButton link={link} />
            <CallButtons channelKey={channelKey('link', link.id)} />
          </>
        }
        banner={<CallPanel channelKey={channelKey('link', link.id)} />}
        aside={<DmProfilePanel user={u} />}
        welcome={
          <div className="mx-4 mb-4 mt-16">
            <Avatar user={u} size={80} />
            <h2 className="mt-2 text-[32px] font-bold leading-tight text-fg">{name}</h2>
            <p className="text-lg text-fg">{userTag(u)}</p>
            <p className="mt-2 text-fg-muted">
              This is the beginning of your {term('link').toLowerCase()} history with <strong>@{name}</strong>.
            </p>
            {link.encryptedAt && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-online">
                <Lock className="h-4 w-4" /> Transmissions here are end-to-end encrypted.
              </p>
            )}
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
        actions={
          <>
            <MeshEncryptionButton mesh={mesh} />
            <CallButtons channelKey={channelKey('mesh', mesh.id)} />
          </>
        }
        banner={<CallPanel channelKey={channelKey('mesh', mesh.id)} />}
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
            {mesh.encryptedAt && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-online">
                <Lock className="h-4 w-4" /> Transmissions and calls here are end-to-end encrypted.
              </p>
            )}
          </div>
        }
      />
    );
  }

  return <Navigate to="/channels/@me" replace />;
}
