import { useEffect, useState } from 'react';
import { useStore } from '../../data/store';
import { http } from '../../lib/http';
import { userTag } from '../../lib/normalize';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from '../chat/markdown';
import { useMarkdownResolvers } from '../chat/resolvers';
import type { FullProfile } from './useProfile';

/** Banner + avatar header shared by the popout and the full profile. */
export function ProfileHeader({ profile, avatarSize = 80, bannerHeight = 105 }: { profile: FullProfile; avatarSize?: number; bannerHeight?: number }) {
  const u = profile.user;
  const banner = profile.member?.bannerUrl ?? u.bannerUrl;
  const avatarSrc = profile.member?.avatarUrl ?? u.avatarUrl;
  return (
    <div className="relative">
      <div className="w-full" style={{ height: bannerHeight, background: banner ? `center / cover no-repeat url("${banner}")` : u.bannerColor || 'var(--color-brand-strong)' }} />
      <div className="absolute left-4" style={{ top: bannerHeight - avatarSize / 2 }}>
        <Avatar user={{ ...u, avatarUrl: avatarSrc ?? null }} size={avatarSize} showPresence ring="var(--color-overlay)" className="rounded-full ring-[6px] ring-overlay" />
      </div>
      <div style={{ height: avatarSize / 2 + 12 }} />
    </div>
  );
}

export function ProfileIdentity({ profile, beaconId }: { profile: FullProfile; beaconId?: string }) {
  const u = profile.user;
  const status = useStore((s) => s.presence[u.id]?.customStatus ?? u.customStatus);
  const pronouns = profile.member?.pronouns ?? u.pronouns;
  return (
    <div>
      <UserName user={u} beaconId={beaconId} className="block text-xl font-bold leading-tight" />
      <p className="text-sm text-fg">
        {userTag(u)}
        {pronouns && <span className="text-fg-muted"> · {pronouns}</span>}
      </p>
      {(u.staffRank ?? 0) >= 1 && <span className="mt-1 inline-block rounded-xs bg-brand px-1.5 text-[10px] font-bold uppercase leading-5 text-on-brand">Command Staff</span>}
      {status?.text && (
        <p className="mt-2 inline-block rounded-lg bg-raised px-2.5 py-1.5 text-sm text-fg">
          {status.emoji && !status.emoji.startsWith('custom:') && <span className="mr-1">{status.emoji}</span>}
          {status.text}
        </p>
      )}
    </div>
  );
}

export function ProfileBio({ profile, beaconId }: { profile: FullProfile; beaconId?: string }) {
  const bio = profile.member?.bio ?? profile.user.bio;
  const resolvers = useMarkdownResolvers(beaconId);
  if (!bio) return null;
  return (
    <section>
      <h4 className="mb-1 text-xs font-bold uppercase text-fg-muted">About Me</h4>
      <div className="text-sm text-fg">
        <Markdown content={bio} resolvers={resolvers} />
      </div>
    </section>
  );
}

export function ProfileMeta({ profile }: { profile: FullProfile }) {
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
  const since = fmt(profile.user.createdAt);
  const joined = fmt(profile.member?.joinedAt);
  if (!since && !joined) return null;
  return (
    <section>
      <h4 className="mb-1 text-xs font-bold uppercase text-fg-muted">Member Since</h4>
      <p className="text-sm text-fg">
        {since && <span>Subspace: {since}</span>}
        {since && joined && <span className="mx-2 text-fg-subtle">·</span>}
        {joined && <span>This beacon: {joined}</span>}
      </p>
    </section>
  );
}

export function ProfileClearances({ profile }: { profile: FullProfile }) {
  const list = profile.member?.clearances ?? [];
  if (!list.length) return null;
  return (
    <section>
      <h4 className="mb-1 text-xs font-bold uppercase text-fg-muted">Clearances</h4>
      <div className="flex flex-wrap gap-1">
        {list.map((c) => (
          <span key={c.id} className="flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-xs text-fg">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>
    </section>
  );
}

export function ProfileCommendations({ profile }: { profile: FullProfile }) {
  if (!profile.commendations.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {profile.commendations.map((c) => (
        <span key={c.code} title={`${c.name}: ${c.description}`} className="flex h-6 w-6 items-center justify-center rounded-md bg-raised">
          <img src={c.iconUrl} alt={c.name} className="h-5 w-5 object-contain" />
        </span>
      ))}
    </div>
  );
}

/** Private per-viewer note (saved on blur). */
export function ProfileNote({ userId, initial }: { userId: string; initial: string | null }) {
  const [note, setNote] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial ?? '');
  useEffect(() => {
    setNote(initial ?? '');
    setSaved(initial ?? '');
  }, [initial]);
  return (
    <section>
      <h4 className="mb-1 text-xs font-bold uppercase text-fg-muted">Note</h4>
      <textarea
        value={note}
        maxLength={256}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note === saved) return;
          setSaved(note);
          void http.put(`/users/${userId}/note`, { note }).catch(() => {});
        }}
        placeholder="Click to add a note"
        aria-label="Note (only you can see this)"
        className="w-full resize-none rounded-sm bg-transparent px-1 py-0.5 text-xs text-fg outline-none placeholder:text-fg-subtle focus:bg-void"
      />
    </section>
  );
}
