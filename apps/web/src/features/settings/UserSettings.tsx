import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { clsx } from 'clsx';
import { THEME, Button, Input } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore, setState } from '../../data/store';
import { signOut, setMyPresence } from '../../data/actions';
import { setNotificationSetting } from '../../data/notificationActions';
import { readNotifyPrefs, writeNotifyPrefs, requestDesktopPermission, playPing } from '../../data/notifications';
import { http, ApiError } from '../../lib/http';
import { pickImage, uploadMedia } from '../../lib/media';
import { userTag } from '../../lib/normalize';
import { term } from '../../lib/strings';
import type { DisplayNameStyle, SelfUser, CustomStatus } from '../../lib/types';
import { closeModal, confirmAction, toast } from '../../app/ui';
import { SettingsLayout, SettingsHeader, SettingsTitle, Field, Switch, SaveBar } from './SettingsLayout';
import {
  Accessibility,
  Bell,
  CreditCard,
  Gift,
  Keyboard,
  Languages,
  Laptop,
  Link2,
  LogOut,
  Mic,
  Palette,
  Pencil,
  Shield,
  Smile,
  Sparkles,
  User,
  UserPen,
  Users,
} from 'lucide-react';
import { Avatar } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from '../chat/markdown';

const USERNAME_RE = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9_.]{2,32}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const EFFECTS: DisplayNameStyle['effect'][] = ['solid', 'gradient', 'neon', 'toon', 'pop'];

// ---------------------------------------------------------------------------
// My Account
// ---------------------------------------------------------------------------

function AccountTab({ me, go }: { me: SelfUser; go: (tab: string) => void }) {
  const [revealEmail, setRevealEmail] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [twofa, setTwofa] = useState<{ secret: string; qr: string; codes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const enabled = !!me.is2faEnabled;
  const maskedEmail = me.email ? me.email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(b.length) + c) : '';

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return toast('New password must be at least 8 characters.', 'error');
    setPwBusy(true);
    try {
      await http.patch('/auth/me/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '' });
      toast('Password updated. Other sessions were signed out.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const start2fa = async () => {
    try {
      const res = await http.post<{ secret: string; uri: string; backupCodes: string[] }>('/auth/2fa/setup');
      setTwofa({ secret: res.secret, qr: await QRCode.toDataURL(res.uri, { margin: 1, width: 176 }), codes: res.backupCodes });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const verify2fa = async () => {
    try {
      const { api } = await import('../../services/api');
      await http.post('/auth/2fa/verify', { token: api.getToken(), code: code.trim() });
      setState((s) => ({ me: s.me ? { ...s.me, is2faEnabled: true } : s.me }));
      toast('Two-factor authentication enabled.', 'success');
    } catch (err) {
      toast((err as Error).message || 'Invalid code', 'error');
    }
  };

  const disable2fa = async () => {
    try {
      await http.post('/auth/2fa/disable', { code: code.trim() });
      setState((s) => ({ me: s.me ? { ...s.me, is2faEnabled: false } : s.me }));
      setTwofa(null);
      setCode('');
      toast('Two-factor authentication removed.');
    } catch (err) {
      toast((err as Error).message || 'Invalid code', 'error');
    }
  };

  return (
    <>
      <SettingsTitle>My Account</SettingsTitle>
      <section className="overflow-hidden rounded-xl bg-raised">
        <div className="h-24" style={{ background: me.bannerUrl ? `center/cover url("${me.bannerUrl}")` : me.bannerColor || 'var(--color-brand-strong)' }} />
        <div className="flex items-end gap-4 px-4">
          <Avatar user={me} size={80} showPresence className="-mt-10 rounded-full ring-[6px] ring-raised" ring="var(--color-raised)" />
          <div className="mb-2 min-w-0 flex-1">
            <p className="truncate text-xl font-bold text-fg">{me.displayName || me.username}</p>
            <p className="text-sm text-fg-muted">{userTag(me)}</p>
          </div>
          <Button size="sm" className="mb-3" onClick={() => go('profile')}>
            Edit User Profile
          </Button>
        </div>
        <dl className="m-4 space-y-4 rounded-lg bg-overlay p-4">
          {[
            ['Display Name', me.displayName || 'You haven’t added a display name yet.'],
            ['Username', userTag(me)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <div>
                <dt className="text-xs font-bold uppercase text-fg-muted">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
              <Button size="sm" variant="secondary" onClick={() => go('profile')}>
                Edit
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4">
            <div>
              <dt className="text-xs font-bold uppercase text-fg-muted">Email</dt>
              <dd className="text-fg">
                {revealEmail ? me.email : maskedEmail}{' '}
                <button className="text-sm text-brand-sky hover:underline" onClick={() => setRevealEmail((v) => !v)}>
                  {revealEmail ? 'Hide' : 'Reveal'}
                </button>
              </dd>
            </div>
          </div>
        </dl>
      </section>

      <h3 className="mb-3 mt-10 text-lg font-bold text-fg">Password and Authentication</h3>
      <form onSubmit={changePassword} className="grid max-w-md gap-3">
        <Input label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        <Input label="New password" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} hint="At least 8 characters." required />
        <div>
          <Button type="submit" isLoading={pwBusy} disabled={!pw.current || !pw.next}>
            Change Password
          </Button>
        </div>
      </form>

      <div className="mt-8">
        <p className="text-xs font-bold uppercase text-fg-muted">
          Authenticator App {enabled && <span className="ml-1 rounded-xs bg-online px-1 text-[10px] text-void">Enabled</span>}
        </p>
        <p className="mt-1 max-w-lg text-sm text-fg-muted">Protect your account with an extra layer of security. You'll need a code from your authenticator app when signing in.</p>
        {!enabled && !twofa && (
          <Button className="mt-3" onClick={start2fa}>
            Enable Authenticator App
          </Button>
        )}
        {!enabled && twofa && (
          <div className="mt-4 flex gap-6 rounded-lg bg-raised p-4">
            <img src={twofa.qr} alt="Authenticator QR code" className="h-44 w-44 rounded-md bg-white p-1" />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-sm text-fg">Scan the QR code with an authenticator app, or enter this key:</p>
              <code className="block break-all rounded-md bg-void px-2 py-1 font-mono text-xs text-fg">{twofa.secret}</code>
              <Input label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button onClick={verify2fa} disabled={code.length !== 6}>
                Activate
              </Button>
              <details className="text-sm text-fg-muted">
                <summary className="cursor-pointer text-fg">Backup codes (save these now)</summary>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-fg">
                  {twofa.codes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        )}
        {enabled && (
          <div className="mt-3 flex max-w-md items-end gap-3">
            <Input label="Code to remove 2FA" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or backup code" />
            <Button variant="danger" onClick={disable2fa} disabled={!code}>
              Remove
            </Button>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <span className="text-sm text-fg-muted">Security keys and passkeys</span>
        <span className="rounded-md bg-raised px-2 py-1 text-xs text-fg-subtle" title="Coming soon">Coming soon</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface ProfileDraft {
  displayName: string;
  username: string;
  pronouns: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bannerColor: string;
  themePrimary: string;
  themeAccent: string;
  style: DisplayNameStyle;
}

const draftFrom = (me: SelfUser & Record<string, any>): ProfileDraft => ({
  displayName: me.displayName ?? '',
  username: me.username,
  pronouns: me.pronouns ?? '',
  bio: me.bio ?? '',
  avatarUrl: me.avatarUrl,
  bannerUrl: me.bannerUrl,
  bannerColor: me.bannerColor ?? '#3353D6',
  themePrimary: me.themePrimary ?? '',
  themeAccent: me.themeAccent ?? '',
  style: me.displayNameStyle ?? { font: me.displayFont ?? 'default', effect: 'solid', colors: [me.displayColor ?? '#EEF1FA'] },
});

function ImageField({ label, value, onChange, purpose, round }: { label: string; value: string | null; onChange: (v: string | null) => void; purpose: 'avatar' | 'banner'; round?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          isLoading={busy}
          onClick={async () => {
            const file = await pickImage();
            if (!file) return;
            setBusy(true);
            try {
              onChange(await uploadMedia(purpose, file));
            } catch (err) {
              toast(err instanceof ApiError && err.status === 404 ? 'Image uploads are not available on this instance yet.' : (err as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Change {label}
        </Button>
        {value && (
          <Button size="sm" variant="link" className="text-fg-muted" onClick={() => onChange(null)}>
            Remove {label}
          </Button>
        )}
        {value && <img src={value} alt="" className={clsx('h-10 object-cover', round ? 'w-10 rounded-full' : 'w-20 rounded-md')} />}
      </div>
    </Field>
  );
}

function ColorField({ label, value, onChange, allowEmpty }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-bold uppercase text-fg-muted">
      {label}
      <span className="flex items-center gap-2">
        <input type="color" value={HEX.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded-md border border-line bg-void" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={allowEmpty ? 'None' : '#000000'}
          className={clsx('h-10 w-28 rounded-md border bg-void px-2 font-mono text-sm normal-case text-fg outline-none', value && !HEX.test(value) ? 'border-danger' : 'border-line')}
        />
        {allowEmpty && value && (
          <button type="button" onClick={() => onChange('')} className="text-xs normal-case text-fg-muted hover:underline">
            Clear
          </button>
        )}
      </span>
    </label>
  );
}

function ProfilePreview({ me, d }: { me: SelfUser; d: ProfileDraft }) {
  const user = { ...me, displayName: d.displayName || null, avatarUrl: d.avatarUrl, displayNameStyle: d.style };
  const theme = d.themePrimary || d.themeAccent ? { background: `linear-gradient(180deg, ${d.themePrimary || 'var(--color-overlay)'}, ${d.themeAccent || d.themePrimary})` } : undefined;
  return (
    <div className="w-[300px] shrink-0">
      <p className="mb-2 text-xs font-bold uppercase text-fg-muted">Preview</p>
      <div className="overflow-hidden rounded-xl bg-overlay shadow-pop" style={theme}>
        <div className="h-[105px]" style={{ background: d.bannerUrl ? `center/cover url("${d.bannerUrl}")` : d.bannerColor }} />
        <Avatar user={user} size={80} showPresence className="-mt-10 ml-4 rounded-full ring-[6px] ring-overlay" ring="var(--color-overlay)" />
        <div className="m-3 mt-2 space-y-2 rounded-lg bg-void/60 p-3">
          <UserName user={user} className="block text-xl font-bold" />
          <p className="text-sm text-fg">
            {d.username}#{me.discriminator}
            {d.pronouns && <span className="text-fg-muted"> · {d.pronouns}</span>}
          </p>
          {d.bio && (
            <div className="border-t border-line pt-2 text-sm text-fg">
              <Markdown content={d.bio} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ me }: { me: SelfUser }) {
  const initial = useMemo(() => draftFrom(me as any), [me]);
  const [d, setD] = useState<ProfileDraft>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setD(initial), [initial]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const usernameError = d.username !== me.username && !USERNAME_RE.test(d.username) ? '2-32 chars: a-z 0-9 _ . (no leading, trailing or double dots)' : undefined;

  const save = async () => {
    if (usernameError) return;
    setSaving(true);
    try {
      const body = {
        displayName: d.displayName.trim(),
        pronouns: d.pronouns.trim() || null,
        bio: d.bio.trim() || null,
        avatarUrl: d.avatarUrl,
        bannerUrl: d.bannerUrl,
        bannerColor: d.bannerColor,
        themePrimary: HEX.test(d.themePrimary) ? d.themePrimary : null,
        themeAccent: HEX.test(d.themeAccent) ? d.themeAccent : null,
        displayNameStyle: d.style,
        ...(d.username !== me.username ? { username: d.username } : {}),
      };
      let res: { transmitter: any };
      try {
        res = await http.patch('/users/@me/profile', body);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        res = await http.patch('/auth/me/profile', { ...body, displayFont: d.style.font, displayColor: d.style.colors[0] });
      }
      setState((s) => ({ me: s.me ? { ...s.me, ...res.transmitter } : s.me }));
      toast('Profile saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsTitle>Profiles</SettingsTitle>
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <Field label="Display Name">
            <Input value={d.displayName} maxLength={32} onChange={(e) => set('displayName', e.target.value)} placeholder={d.username} />
          </Field>
          <Field label="Username" hint={d.username !== me.username ? 'Changing your username gives you a new random tag.' : `Your tag is ${userTag(me)}.`}>
            <Input value={d.username} maxLength={32} onChange={(e) => set('username', e.target.value.toLowerCase())} error={usernameError} />
          </Field>
          <Field label="Pronouns">
            <Input value={d.pronouns} maxLength={40} onChange={(e) => set('pronouns', e.target.value)} placeholder="Add your pronouns" />
          </Field>
          <ImageField label="Avatar" value={d.avatarUrl} onChange={(v) => set('avatarUrl', v)} purpose="avatar" round />
          <ImageField label="Banner" value={d.bannerUrl} onChange={(v) => set('bannerUrl', v)} purpose="banner" />
          <Field label="Banner Color">
            <ColorField label="" value={d.bannerColor} onChange={(v) => set('bannerColor', v)} />
          </Field>
          <Field label="Profile Theme" hint="Two colors blended across your whole profile card.">
            <div className="flex gap-4">
              <ColorField label="Primary" value={d.themePrimary} onChange={(v) => set('themePrimary', v)} allowEmpty />
              <ColorField label="Accent" value={d.themeAccent} onChange={(v) => set('themeAccent', v)} allowEmpty />
            </div>
          </Field>
          <Field label="Display Name Style">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold uppercase text-fg-muted">
                Font
                <select value={d.style.font} onChange={(e) => set('style', { ...d.style, font: e.target.value })} className="mt-1.5 block h-10 w-full rounded-md border border-line bg-void px-2 text-sm normal-case text-fg">
                  {THEME.fonts.map((f) => (
                    <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold uppercase text-fg-muted">
                Effect
                <select
                  value={d.style.effect}
                  onChange={(e) => {
                    const effect = e.target.value as DisplayNameStyle['effect'];
                    set('style', { ...d.style, effect, colors: effect === 'gradient' && d.style.colors.length < 2 ? [d.style.colors[0] ?? '#3DCBFF', '#3353D6'] : d.style.colors });
                  }}
                  className="mt-1.5 block h-10 w-full rounded-md border border-line bg-void px-2 text-sm capitalize normal-case text-fg"
                >
                  {EFFECTS.map((x) => (
                    <option key={x} value={x}>
                      {x[0].toUpperCase() + x.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex gap-4">
              <ColorField label="Color" value={d.style.colors[0] ?? ''} onChange={(v) => set('style', { ...d.style, colors: [v, ...d.style.colors.slice(1)] })} />
              {d.style.effect !== 'solid' && d.style.effect !== 'neon' && (
                <ColorField label="Second color" value={d.style.colors[1] ?? ''} onChange={(v) => set('style', { ...d.style, colors: [d.style.colors[0] ?? '#EEF1FA', v] })} />
              )}
            </div>
          </Field>
          <Field label="About Me" hint="You can use markdown and links if you'd like.">
            <div className="relative">
              <textarea value={d.bio} maxLength={190} rows={4} onChange={(e) => set('bio', e.target.value)} className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
              <span className="absolute bottom-2 right-3 text-xs text-fg-subtle">{190 - d.bio.length}</span>
            </div>
          </Field>
          <Field label="Avatar Decoration · Profile Effect · Nameplate">
            <span className="text-sm text-fg-subtle">Coming soon.</span>
          </Field>
        </div>
        <ProfilePreview me={me} d={d} />
      </div>
      <SaveBar visible={dirty} saving={saving} onReset={() => setD(initial)} onSave={() => void save()} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Beacon profile
// ---------------------------------------------------------------------------

function BeaconProfileTab({ initialBeacon }: { initialBeacon?: string }) {
  const beacons = useStore(useShallow((s) => s.beaconOrder.map((id) => s.beacons[id]).filter(Boolean)));
  const [beaconId, setBeaconId] = useState(initialBeacon ?? beacons[0]?.id ?? '');
  const member = useStore((s) => (s.me ? s.members[beaconId]?.[s.me.id] : undefined));
  const [nickname, setNickname] = useState(member?.nickname ?? '');
  const [bio, setBio] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setNickname(member?.nickname ?? ''), [member?.nickname, beaconId]);

  const save = async () => {
    setSaving(true);
    try {
      await http.patch(`/beacons/${beaconId}/members/@me`, { nickname: nickname.trim() || null, bio: bio.trim() || null, pronouns: pronouns.trim() || null, avatarUrl });
      toast(`${term('beacon')} profile saved`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!beacons.length) return <p className="text-fg-muted">Join a {term('beacon').toLowerCase()} to set a {term('beacon').toLowerCase()} profile.</p>;
  return (
    <>
      <SettingsTitle>{term('beacon')} Profiles</SettingsTitle>
      <p className="mb-6 text-sm text-fg-muted">Show who you are with different profiles for each of your {term('beacon', true).toLowerCase()}. Unset fields use your main profile.</p>
      <Field label={term('beacon')}>
        <select value={beaconId} onChange={(e) => setBeaconId(e.target.value)} className="h-10 w-full rounded-md border border-line bg-void px-2 text-fg">
          {beacons.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`${term('beacon')} Nickname`}>
        <Input value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} />
      </Field>
      <Field label="Pronouns">
        <Input value={pronouns} maxLength={40} onChange={(e) => setPronouns(e.target.value)} />
      </Field>
      <ImageField label="Avatar" value={avatarUrl} onChange={setAvatarUrl} purpose="avatar" round />
      <Field label="About Me">
        <textarea value={bio} maxLength={190} rows={3} onChange={(e) => setBio(e.target.value)} className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
      </Field>
      <Button onClick={save} isLoading={saving}>
        Save {term('beacon')} Profile
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Custom status
// ---------------------------------------------------------------------------

const CLEAR_AFTER = [
  { label: "Don't clear", ms: 0 },
  { label: '30 minutes', ms: 30 * 60e3 },
  { label: '1 hour', ms: 60 * 60e3 },
  { label: '4 hours', ms: 4 * 60 * 60e3 },
  { label: 'Today', ms: -1 },
];

function StatusTab({ me }: { me: SelfUser }) {
  const current = useStore((s) => s.presence[me.id]?.customStatus ?? me.customStatus);
  const presence = useStore((s) => s.presence[me.id]?.status ?? 'online');
  const [text, setText] = useState(current?.text ?? '');
  const [emoji, setEmoji] = useState(current?.emoji ?? '');
  const [clear, setClear] = useState(0);

  const save = async (status: CustomStatus | null) => {
    try {
      await http.patch('/users/@me/status', { customStatus: status });
      setState((s) => ({ presence: { ...s.presence, [me.id]: { status: s.presence[me.id]?.status ?? 'online', customStatus: status } } }));
      toast(status ? 'Status set' : 'Status cleared', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const submit = () => {
    const option = CLEAR_AFTER[clear];
    let expiresAt: string | null = null;
    if (option.ms > 0) expiresAt = new Date(Date.now() + option.ms).toISOString();
    if (option.ms < 0) {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      expiresAt = end.toISOString();
    }
    void save(text.trim() || emoji ? { text: text.trim(), emoji: emoji || undefined, expiresAt } : null);
  };

  return (
    <>
      <SettingsTitle>Custom Status</SettingsTitle>
      <Field label="What's cookin'?">
        <div className="flex gap-2">
          <input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 8))} aria-label="Status emoji" placeholder="🛰️" className="h-10 w-14 rounded-md border border-line bg-void text-center text-xl outline-none focus:border-brand" />
          <Input value={text} maxLength={128} onChange={(e) => setText(e.target.value)} placeholder="Support has arrived!" />
        </div>
      </Field>
      <Field label="Clear after">
        <select value={clear} onChange={(e) => setClear(Number(e.target.value))} className="h-10 w-full rounded-md border border-line bg-void px-2 text-fg">
          {CLEAR_AFTER.map((c, i) => (
            <option key={c.label} value={i}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select value={presence} onChange={(e) => setMyPresence(e.target.value as any)} className="h-10 w-full rounded-md border border-line bg-void px-2 text-fg">
          <option value="online">Online</option>
          <option value="idle">Idle</option>
          <option value="dnd">Do Not Disturb</option>
          <option value="invisible">Invisible (Ghost Mode)</option>
        </select>
      </Field>
      <div className="flex gap-3">
        <Button onClick={submit}>Save</Button>
        {current?.text && (
          <Button variant="secondary" onClick={() => void save(null)}>
            Clear Status
          </Button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Privacy, notifications, voice, appearance, keybinds
// ---------------------------------------------------------------------------

function PrivacyTab({ me }: { me: SelfUser & Record<string, any> }) {
  const [visibility, setVisibility] = useState<string>(me.profileVisibility ?? 'everyone');
  const save = async (v: string) => {
    setVisibility(v);
    await http.patch('/users/@me/profile', { profileVisibility: v }).catch((e) => toast(e.message, 'error'));
  };
  return (
    <>
      <SettingsTitle>Privacy &amp; Safety</SettingsTitle>
      <Field label="Who can view your full profile" hint="This never affects who can send you transmissions or affiliation requests.">
        {[
          ['everyone', 'Everyone'],
          ['beacons', `Members of your ${term('beacon', true).toLowerCase()}`],
          ['friends', `${term('affiliate', true)} only`],
        ].map(([v, l]) => (
          <label key={v} className={clsx('mb-2 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5', visibility === v ? 'bg-active' : 'bg-raised hover:bg-hover')}>
            <input type="radio" checked={visibility === v} onChange={() => void save(v)} className="accent-[var(--color-brand)]" />
            <span className="text-fg">{l}</span>
          </label>
        ))}
      </Field>
      <Switch label={`Allow ${term('link', true).toLowerCase()} from ${term('beacon').toLowerCase()} members`} description="Coming soon" checked disabled onChange={() => {}} />
      <Switch label="Filter explicit media" description="Coming soon" checked disabled onChange={() => {}} />
    </>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState(readNotifyPrefs);
  const [permission, setPermission] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const dmSetting = useStore((s) => s.notificationSettings['global:@global']);
  const update = (p: typeof prefs) => {
    setPrefs(p);
    writeNotifyPrefs(p);
  };
  return (
    <>
      <SettingsTitle>Notifications</SettingsTitle>
      <Switch
        label="Enable Desktop Notifications"
        description={permission === 'denied' ? 'Your browser has blocked notifications for this site.' : undefined}
        checked={prefs.desktop && permission === 'granted'}
        onChange={async (v) => {
          if (v && permission !== 'granted') setPermission(await requestDesktopPermission());
          update({ ...prefs, desktop: v });
        }}
      />
      <Switch
        label="Notification Sounds"
        checked={prefs.sounds}
        onChange={(v) => {
          update({ ...prefs, sounds: v });
          if (v) playPing();
        }}
      />
      <Field label={`Default for ${term('beacon', true).toLowerCase()} you join`}>
        <select
          value={dmSetting?.level && dmSetting.level !== 'inherit' ? dmSetting.level : 'mentions'}
          onChange={(e) => void setNotificationSetting('global', '@global', { level: e.target.value as any })}
          className="mt-4 h-10 w-full rounded-md border border-line bg-void px-2 text-fg"
        >
          <option value="all">All Transmissions</option>
          <option value="mentions">Only @mentions</option>
          <option value="nothing">Nothing</option>
        </select>
      </Field>
      <p className="text-sm text-fg-muted">
        Per-{term('beacon').toLowerCase()} settings live in each beacon's menu under <strong>Notification Settings</strong>. {term('link', true)} always notify unless muted.
      </p>
    </>
  );
}

function VoiceTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('subspace_av_devices') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
  }, []);
  const set = (k: string, v: string) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try {
      localStorage.setItem('subspace_av_devices', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const pick = (kind: MediaDeviceKind, key: string, label: string) => (
    <Field label={label}>
      <select value={prefs[key] ?? 'default'} onChange={(e) => set(key, e.target.value)} className="h-10 w-full rounded-md border border-line bg-void px-2 text-fg">
        <option value="default">Default</option>
        {devices
          .filter((d) => d.kind === kind && d.deviceId !== 'default')
          .map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${kind} ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
      </select>
    </Field>
  );
  return (
    <>
      <SettingsTitle>Voice &amp; Video</SettingsTitle>
      <div className="grid grid-cols-2 gap-4">
        {pick('audioinput', 'audioInput', 'Input Device')}
        {pick('audiooutput', 'audioOutput', 'Output Device')}
      </div>
      {pick('videoinput', 'videoInput', 'Camera')}
      <Switch label="Echo Cancellation" checked disabled description="Always on" onChange={() => {}} />
      <Switch label="Noise Suppression" checked disabled description="Always on" onChange={() => {}} />
      <Switch label="Mic Test and Input Sensitivity" description="Coming soon" checked={false} disabled onChange={() => {}} />
    </>
  );
}

function AppearanceTab() {
  const [scale, setScale] = useState(() => Number(localStorage.getItem('subspace_font_scale') || '16'));
  useEffect(() => {
    document.documentElement.style.fontSize = `${scale}px`;
    try {
      localStorage.setItem('subspace_font_scale', String(scale));
    } catch {
      /* ignore */
    }
  }, [scale]);
  return (
    <>
      <SettingsTitle>Appearance</SettingsTitle>
      <Field label="Theme" hint="Subspace is dark by design.">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-void ring-2 ring-brand" aria-label="Deep space (active)" />
      </Field>
      <Field label={`Chat Font Scaling — ${scale}px`}>
        <input type="range" min={12} max={20} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-full accent-[var(--color-brand)]" />
      </Field>
      <Switch label="Compact message display" description="Coming soon" checked={false} disabled onChange={() => {}} />
    </>
  );
}

const KEYBINDS: Array<[string, string]> = [
  ['Ctrl + K', 'Quick Scan (switch beacons, relays, links)'],
  ['Alt + ↑ / ↓', 'Previous / next relay'],
  ['Alt + Shift + ↑ / ↓', 'Previous / next unread relay'],
  ['Esc', 'Mark relay as read'],
  ['Shift + Esc', 'Mark beacon as read'],
  ['↑ (empty composer)', 'Edit your last transmission'],
  ['Enter / Shift + Enter', 'Send / new line'],
  ['Esc (while replying)', 'Cancel reply'],
];

function KeybindsTab() {
  return (
    <>
      <SettingsTitle>Keybinds</SettingsTitle>
      <dl className="divide-y divide-line rounded-lg bg-raised">
        {KEYBINDS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-3">
            <dt className="text-fg">{v}</dt>
            <dd>
              <kbd className="rounded-md bg-void px-2 py-1 font-mono text-xs text-fg">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

// ---------------------------------------------------------------------------

export function UserSettings({ tab: initialTab }: { tab?: string }) {
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState(initialTab?.startsWith('beacon-profile') ? 'beacon-profile' : initialTab ?? 'account');
  const initialBeacon = initialTab?.startsWith('beacon-profile:') ? initialTab.split(':')[1] : undefined;
  if (!me) return null;

  return (
    <SettingsLayout
      title="User Settings"
      header={
        <SettingsHeader
          media={<Avatar user={me} size={40} />}
          name={me.displayName || me.username}
          action={
            <button type="button" onClick={() => setTab('profile')} className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg hover:underline">
              Edit Profiles <Pencil className="h-3 w-3" />
            </button>
          }
        />
      }
      active={tab}
      onSelect={setTab}
      onClose={closeModal}
      sections={[
        {
          heading: 'User Settings',
          items: [
            { id: 'account', icon: <User />, label: 'My Account' },
            { id: 'profile', icon: <UserPen />, label: 'Profiles' },
            { id: 'beacon-profile', icon: <Users />, label: `${term('beacon')} Profiles` },
            { id: 'status', icon: <Smile />, label: 'Custom Status' },
            { id: 'privacy', icon: <Shield />, label: 'Privacy & Safety' },
            { id: 'devices', icon: <Laptop />, label: 'Devices', comingSoon: true },
            { id: 'connections', icon: <Link2 />, label: 'Connections', comingSoon: true },
          ],
        },
        {
          heading: 'Billing Settings',
          items: [
            { id: 'nitro', icon: <Sparkles />, label: 'Subscriptions', comingSoon: true },
            { id: 'gifts', icon: <Gift />, label: 'Gift Inventory', comingSoon: true },
            { id: 'billing', icon: <CreditCard />, label: 'Billing', comingSoon: true },
          ],
        },
        {
          heading: 'App Settings',
          items: [
            { id: 'appearance', icon: <Palette />, label: 'Appearance' },
            { id: 'voice', icon: <Mic />, label: 'Voice & Video' },
            { id: 'notifications', icon: <Bell />, label: 'Notifications' },
            { id: 'keybinds', icon: <Keyboard />, label: 'Keybinds' },
            { id: 'accessibility', icon: <Accessibility />, label: 'Accessibility', comingSoon: true },
            { id: 'language', icon: <Languages />, label: 'Language', comingSoon: true },
          ],
        },
        {
          items: [
            {
              id: 'logout',
              icon: <LogOut />,
              label: 'Log Out',
              danger: true,
              onClick: () =>
                confirmAction({
                  title: 'Log Out',
                  body: 'Are you sure you want to log out?',
                  confirmLabel: 'Log Out',
                  danger: true,
                  onConfirm: () => signOut(),
                }),
            },
          ],
        },
      ]}
    >
      {tab === 'account' && <AccountTab me={me} go={setTab} />}
      {tab === 'profile' && <ProfileTab me={me} />}
      {tab === 'beacon-profile' && <BeaconProfileTab initialBeacon={initialBeacon} />}
      {tab === 'status' && <StatusTab me={me} />}
      {tab === 'privacy' && <PrivacyTab me={me as any} />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'keybinds' && <KeybindsTab />}
    </SettingsLayout>
  );
}
