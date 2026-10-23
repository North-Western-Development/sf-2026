import { useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { clsx } from 'clsx';
import { THEME, Button, Input, Modal } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import {
  Accessibility,
  Bell,
  CreditCard,
  Gift,
  Keyboard,
  KeyRound,
  Languages,
  Laptop,
  Link2,
  LogOut,
  Mic,
  Palette,
  Pencil,
  Rocket,
  Shield,
  ShieldCheck,
  Smile,
  Sparkles,
  User,
  UserPen,
} from 'lucide-react';
import { useStore, setState } from '../../data/store';
import { signOut, setMyPresence, loadBeacon } from '../../data/actions';
import { setNotificationSetting } from '../../data/notificationActions';
import { readNotifyPrefs, writeNotifyPrefs, requestDesktopPermission, playPing } from '../../data/notifications';
import { http, ApiError } from '../../lib/http';
import { pickImage, uploadMedia } from '../../lib/media';
import { userTag } from '../../lib/normalize';
import { term, PRESENCE_LABELS } from '../../lib/strings';
import type { DisplayNameStyle, SelfUser, CustomStatus, Presence } from '../../lib/types';
import { closeModal, confirmAction, toast } from '../../app/ui';
import {
  ComingSoon,
  Field,
  RadioList,
  RowButton,
  SaveBar,
  SelectField,
  SettingsHeader,
  SettingsLayout,
  SettingsRow,
  SettingsSection,
  Switch,
  useWideSettingsPage,
} from './SettingsLayout';
import { Avatar, PresenceDot } from '../common/Avatar';
import { UserName } from '../common/UserName';
import { Markdown } from '../chat/markdown';

const USERNAME_RE = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9_.]{2,32}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const EFFECTS: DisplayNameStyle['effect'][] = ['solid', 'gradient', 'neon', 'toon', 'pop'];

/** Footer strip shared by the settings dialogs (matches the app's prompt dialog). */
function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">{children}</div>;
}

/** Greyed placeholder row for account features that have no backend yet. */
function PlaceholderRow(props: React.ComponentProps<typeof SettingsRow> & { soon: string }) {
  const { soon, ...row } = props;
  return (
    <ComingSoon label={soon} className="flex w-full [&>*]:flex-1">
      <div>
        <SettingsRow {...row} />
      </div>
    </ComingSoon>
  );
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = pw.confirm.length > 0 && pw.confirm !== pw.next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return toast('New password must be at least 8 characters.', 'error');
    if (pw.next !== pw.confirm) return;
    setBusy(true);
    try {
      await http.patch('/auth/me/password', {
        currentPassword: pw.current,
        newPassword: pw.next,
      });
      toast('Password updated. Other sessions were signed out.', 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Update your password" description="Enter your current password and a new password." maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Current Password"
          type="password"
          autoComplete="current-password"
          value={pw.current}
          onChange={(e) => setPw({ ...pw, current: e.target.value })}
          autoFocus
          required
        />
        <Input
          label="New Password"
          type="password"
          autoComplete="new-password"
          value={pw.next}
          onChange={(e) => setPw({ ...pw, next: e.target.value })}
          hint="At least 8 characters."
          required
        />
        <Input
          label="Confirm New Password"
          type="password"
          autoComplete="new-password"
          value={pw.confirm}
          onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
          error={mismatch ? 'Passwords do not match.' : undefined}
          required
        />
        <DialogFooter>
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!pw.current || !pw.next || pw.next !== pw.confirm}>
            Done
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

function UsernameDialog({ me, onClose }: { me: SelfUser; onClose: () => void }) {
  const [username, setUsername] = useState(me.username);
  const [busy, setBusy] = useState(false);
  const changed = username !== me.username;
  const error = changed && !USERNAME_RE.test(username) ? 'Use 2-32 characters: a-z, 0-9, _ and . (no leading, trailing or double dots).' : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || error) return;
    setBusy(true);
    try {
      const res = await http.patch<{ transmitter: Partial<SelfUser> }>('/users/@me/profile', { username });
      setState((s) => ({ me: s.me ? { ...s.me, ...res.transmitter } : s.me }));
      toast(`You are now ${res.transmitter.username ?? username}#${res.transmitter.discriminator ?? me.discriminator}`, 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Change your username" description="Changing your username gives you a new random #tag." maxWidth="md">
      <form onSubmit={submit}>
        <Input label="Username" value={username} maxLength={32} onChange={(e) => setUsername(e.target.value.toLowerCase())} error={error} autoFocus />
        <p className="mt-2 text-sm text-fg-muted">
          Current tag: <span className="font-medium text-fg">{userTag(me)}</span>
        </p>
        <DialogFooter>
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!changed || !!error}>
            Done
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

function MfaDialog({ enabled, onClose }: { enabled: boolean; onClose: () => void }) {
  const [setup, setSetup] = useState<{
    secret: string;
    qr: string;
    codes: string[];
  } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast((err as Error).message || 'Invalid code', 'error');
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const res = await http.post<{
        secret: string;
        uri: string;
        backupCodes: string[];
      }>('/auth/2fa/setup');
      setSetup({
        secret: res.secret,
        qr: await QRCode.toDataURL(res.uri, { margin: 1, width: 176 }),
        codes: res.backupCodes,
      });
    });

  const activate = () =>
    run(async () => {
      const { api } = await import('../../services/api');
      await http.post('/auth/2fa/verify', {
        token: api.getToken(),
        code: code.trim(),
      });
      setState((s) => ({ me: s.me ? { ...s.me, is2faEnabled: true } : s.me }));
      toast('Authenticator app enabled.', 'success');
      onClose();
    });

  const remove = () =>
    run(async () => {
      await http.post('/auth/2fa/disable', { code: code.trim() });
      setState((s) => ({ me: s.me ? { ...s.me, is2faEnabled: false } : s.me }));
      toast('Authenticator app removed.');
      onClose();
    });

  return (
    <Modal isOpen onClose={onClose} title="Multi-Factor Authentication" maxWidth="lg">
      {enabled ? (
        <>
          <p className="text-sm text-fg-muted">An authenticator app protects your account. Enter a code from the app, or a backup code, to remove it.</p>
          <div className="mt-4">
            <Input label="Authentication code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or backup code" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="link" className="text-fg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} isLoading={busy} disabled={!code.trim()}>
              Remove Authenticator App
            </Button>
          </DialogFooter>
        </>
      ) : !setup ? (
        <>
          <p className="text-sm text-fg-muted">
            Protect your account with an extra layer of security. Once configured, you'll need your password and a code from an authenticator app to sign in.
          </p>
          <DialogFooter>
            <Button variant="link" className="text-fg" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={start} isLoading={busy}>
              Enable Authenticator App
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <div className="flex gap-5">
            <img src={setup.qr} alt="Authenticator QR code" className="h-40 w-40 shrink-0 rounded-md bg-white p-1" />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-sm text-fg">1. Scan the QR code with an authenticator app, or enter this key:</p>
              <code className="block break-all rounded-md bg-void px-2 py-1.5 font-mono text-xs text-fg">{setup.secret}</code>
              <p className="text-sm text-fg">2. Enter the 6-digit code it shows.</p>
              <Input
                aria-label="6-digit code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
              />
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-raised p-3">
            <p className="text-sm font-semibold text-fg">Backup codes</p>
            <p className="text-xs text-fg-muted">Save these somewhere safe. Each can be used once if you lose your device.</p>
            <ul className="mt-2 grid grid-cols-4 gap-1 font-mono text-xs text-fg">
              {setup.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="link" className="text-fg" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={activate} isLoading={busy} disabled={code.length !== 6}>
              Activate
            </Button>
          </DialogFooter>
        </>
      )}
    </Modal>
  );
}

function AccountTab({ me, go }: { me: SelfUser; go: (tab: string) => void }) {
  const [revealEmail, setRevealEmail] = useState(false);
  const [dialog, setDialog] = useState<null | 'password' | 'username' | 'mfa'>(null);
  const maskedEmail = me.email ? me.email.replace(/^(.*)(@.*)$/, (_, a: string, b: string) => '*'.repeat(a.length) + b) : '';
  const close = () => setDialog(null);

  return (
    <>
      <SettingsSection id="account-info" title="Account Info">
        <SettingsRow
          label="Display Name"
          value={me.displayName || <span className="text-fg-subtle">Not set</span>}
          action={<RowButton onClick={() => go('profile')}>Edit</RowButton>}
        />
        <SettingsRow label="Username" value={userTag(me)} action={<RowButton onClick={() => setDialog('username')}>Edit</RowButton>} />
        <SettingsRow
          label="Email"
          value={
            <>
              {revealEmail ? me.email : maskedEmail}{' '}
              <button type="button" className="text-brand-sky hover:underline" onClick={() => setRevealEmail((v) => !v)}>
                {revealEmail ? 'Hide' : 'Reveal'}
              </button>
            </>
          }
          action={
            <ComingSoon label="Changing email">
              <RowButton>Edit</RowButton>
            </ComingSoon>
          }
        />
        <PlaceholderRow soon="Phone numbers" label="Phone Number" value={<span className="text-fg-subtle">Not added</span>} action={<RowButton>Add</RowButton>} />
      </SettingsSection>

      <SettingsSection id="password-security" title="Password & Security">
        <SettingsRow label="Password" action={<RowButton onClick={() => setDialog('password')}>Edit</RowButton>} />
        <SettingsRow label="Multi-Factor Authentication" value={me.is2faEnabled ? 'Enabled' : <span className="text-fg-subtle">Off</span>} onClick={() => setDialog('mfa')} />
        <PlaceholderRow soon="Security keys" label="Security Keys" value={<span className="text-fg-subtle">None</span>} />
        <PlaceholderRow soon="Device management" label="Logged-in Devices" value={<span className="text-fg-subtle">This device</span>} />
      </SettingsSection>

      <SettingsSection id="account-status" title="Account Status">
        <PlaceholderRow
          soon="Account standing"
          icon={<ShieldCheck className="text-online" />}
          label="Account Standing"
          description="Thank you for upholding the Subspace Directives. If you have a violation, it will appear here."
          value="All good"
        />
        <div className="pt-4">
          <p className="text-[15px] font-semibold text-fg">Account Removal</p>
          <p className="mt-0.5 text-sm text-fg-muted">Disabling your account means you can recover it at any time after taking this action.</p>
          <div className="mt-3 flex gap-3">
            <ComingSoon label="Disabling accounts">
              <RowButton danger>Disable Account</RowButton>
            </ComingSoon>
            <ComingSoon label="Deleting accounts">
              <RowButton>Delete Account</RowButton>
            </ComingSoon>
          </div>
        </div>
      </SettingsSection>

      {dialog === 'password' && <PasswordDialog onClose={close} />}
      {dialog === 'username' && <UsernameDialog me={me} onClose={close} />}
      {dialog === 'mfa' && <MfaDialog enabled={!!me.is2faEnabled} onClose={close} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface ProfileDraft {
  displayName: string;
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
  pronouns: me.pronouns ?? '',
  bio: me.bio ?? '',
  avatarUrl: me.avatarUrl,
  bannerUrl: me.bannerUrl,
  bannerColor: me.bannerColor ?? '#3353D6',
  themePrimary: me.themePrimary ?? '',
  themeAccent: me.themeAccent ?? '',
  style: me.displayNameStyle ?? {
    font: me.displayFont ?? 'default',
    effect: 'solid',
    colors: [me.displayColor ?? '#EEF1FA'],
  },
});

/** Divided block inside the profile form. */
function FormBlock({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-5 first:pt-0 last:border-b-0">
      <p className="mb-2 text-sm font-semibold text-fg">{label}</p>
      {children}
      {hint && <p className="mt-2 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

function ImageControls({ noun, value, onChange, purpose }: { noun: string; value: string | null; onChange: (v: string | null) => void; purpose: 'avatar' | 'banner' }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-4">
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
        Change {noun}
      </Button>
      {value && (
        <button type="button" className="text-sm text-fg-muted hover:text-fg hover:underline" onClick={() => onChange(null)}>
          Remove {noun}
        </button>
      )}
    </div>
  );
}

/** Color square that opens the native picker, with an editable hex value. */
function ColorSwatch({ label, value, onChange, allowEmpty }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const valid = HEX.test(value);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <label
        className="relative flex h-12 w-[72px] cursor-pointer items-end justify-end overflow-hidden rounded-md border border-line-strong p-1"
        style={{
          background: valid ? value : 'repeating-linear-gradient(45deg, var(--color-raised) 0 6px, var(--color-void) 6px 12px)',
        }}
      >
        <Pencil className="h-3.5 w-3.5 text-white drop-shadow" />
        <input
          type="color"
          aria-label={label}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <span className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={allowEmpty ? 'None' : '#000000'}
          aria-label={`${label} hex`}
          className={clsx('h-7 w-[72px] rounded border bg-void px-1.5 font-mono text-xs text-fg outline-none', value && !valid ? 'border-danger' : 'border-line')}
        />
        {allowEmpty && value && (
          <button type="button" onClick={() => onChange('')} className="text-xs text-fg-muted hover:underline">
            Clear
          </button>
        )}
      </span>
    </div>
  );
}

function ProfilePreview({ me, d, tag }: { me: SelfUser; d: ProfileDraft; tag?: string }) {
  const user = {
    ...me,
    displayName: d.displayName || null,
    avatarUrl: d.avatarUrl,
    displayNameStyle: d.style,
  };
  const themed = d.themePrimary || d.themeAccent;
  const cardBg = themed
    ? {
        background: `linear-gradient(180deg, ${d.themePrimary || 'var(--color-overlay)'}, ${d.themeAccent || d.themePrimary})`,
      }
    : undefined;
  return (
    <div className="sticky top-0 w-[300px] shrink-0">
      <p className="mb-2 text-sm font-semibold text-fg">Preview</p>
      <div className={clsx('overflow-hidden rounded-xl shadow-pop', !themed && 'bg-overlay', themed && 'p-[3px]')} style={cardBg}>
        <div className={clsx('overflow-hidden', themed && 'rounded-[10px] bg-black/45')}>
          <div
            className="h-[105px]"
            style={{
              background: d.bannerUrl ? `center/cover url("${d.bannerUrl}")` : d.bannerColor,
            }}
          />
          <div className="px-4 pb-4">
            <Avatar user={user} size={80} showPresence className="-mt-10 rounded-full ring-[6px] ring-overlay" ring="var(--color-overlay)" />
            <UserName user={user} className="mt-2 block text-xl font-bold" />
            <p className="text-sm text-fg">
              {tag ?? userTag(me)}
              {d.pronouns && <span className="text-fg-muted"> · {d.pronouns}</span>}
            </p>
            {d.bio && (
              <div className="mt-3 text-sm text-fg">
                <Markdown content={d.bio} />
              </div>
            )}
            <div className="mt-4 rounded-md bg-void/60 px-3 py-2 text-center text-sm font-medium text-fg-muted">Example Button</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserProfileForm({ me }: { me: SelfUser }) {
  const initial = useMemo(() => draftFrom(me as any), [me]);
  const [d, setD] = useState<ProfileDraft>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setD(initial), [initial]);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const twoColor = d.style.effect !== 'solid' && d.style.effect !== 'neon';

  const save = async () => {
    setSaving(true);
    try {
      const res = await http.patch<{ transmitter: Partial<SelfUser> }>('/users/@me/profile', {
        displayName: d.displayName.trim(),
        pronouns: d.pronouns.trim() || null,
        bio: d.bio.trim() || null,
        avatarUrl: d.avatarUrl,
        bannerUrl: d.bannerUrl,
        bannerColor: d.bannerColor,
        themePrimary: HEX.test(d.themePrimary) ? d.themePrimary : null,
        themeAccent: HEX.test(d.themeAccent) ? d.themeAccent : null,
        displayNameStyle: d.style,
      });
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
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <FormBlock label="Display Name">
            <Input value={d.displayName} maxLength={32} onChange={(e) => set('displayName', e.target.value)} placeholder={me.username} aria-label="Display Name" />
          </FormBlock>
          <FormBlock label="Pronouns">
            <Input value={d.pronouns} maxLength={40} onChange={(e) => set('pronouns', e.target.value)} placeholder="Add your pronouns" aria-label="Pronouns" />
          </FormBlock>
          <FormBlock label="Avatar">
            <ImageControls noun="Avatar" value={d.avatarUrl} onChange={(v) => set('avatarUrl', v)} purpose="avatar" />
          </FormBlock>
          <FormBlock label="Avatar Decoration">
            <ComingSoon label="Avatar decorations">
              <Button size="sm">Change Decoration</Button>
            </ComingSoon>
          </FormBlock>
          <FormBlock label="Profile Effect">
            <ComingSoon label="Profile effects">
              <Button size="sm">Change Effect</Button>
            </ComingSoon>
          </FormBlock>
          <FormBlock label="Profile Banner">
            <ImageControls noun="Banner" value={d.bannerUrl} onChange={(v) => set('bannerUrl', v)} purpose="banner" />
            {!d.bannerUrl && (
              <div className="mt-4">
                <ColorSwatch label="Banner color" value={d.bannerColor} onChange={(v) => set('bannerColor', v)} />
              </div>
            )}
          </FormBlock>
          <FormBlock label="Profile Theme" hint="Two colors blended across your whole profile card.">
            <div className="flex gap-4">
              <ColorSwatch label="Primary" value={d.themePrimary} onChange={(v) => set('themePrimary', v)} allowEmpty />
              <ColorSwatch label="Accent" value={d.themeAccent} onChange={(v) => set('themeAccent', v)} allowEmpty />
            </div>
          </FormBlock>
          <FormBlock label="Display Name Style">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-fg-muted">
                Font
                <span className="mt-1.5 block">
                  <SelectField label="Font" value={d.style.font} onChange={(v) => set('style', { ...d.style, font: v })}>
                    {THEME.fonts.map((f) => (
                      <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                        {f.name}
                      </option>
                    ))}
                  </SelectField>
                </span>
              </label>
              <label className="text-xs font-medium text-fg-muted">
                Effect
                <span className="mt-1.5 block">
                  <SelectField
                    label="Effect"
                    value={d.style.effect}
                    onChange={(v) => {
                      const effect = v as DisplayNameStyle['effect'];
                      set('style', {
                        ...d.style,
                        effect,
                        colors: effect === 'gradient' && d.style.colors.length < 2 ? [d.style.colors[0] ?? '#3DCBFF', '#3353D6'] : d.style.colors,
                      });
                    }}
                  >
                    {EFFECTS.map((x) => (
                      <option key={x} value={x}>
                        {x[0].toUpperCase() + x.slice(1)}
                      </option>
                    ))}
                  </SelectField>
                </span>
              </label>
            </div>
            <div className="mt-4 flex gap-4">
              <ColorSwatch
                label={twoColor ? 'Color 1' : 'Color'}
                value={d.style.colors[0] ?? ''}
                onChange={(v) =>
                  set('style', {
                    ...d.style,
                    colors: [v, ...d.style.colors.slice(1)],
                  })
                }
              />
              {twoColor && (
                <ColorSwatch
                  label="Color 2"
                  value={d.style.colors[1] ?? ''}
                  onChange={(v) =>
                    set('style', {
                      ...d.style,
                      colors: [d.style.colors[0] ?? '#EEF1FA', v],
                    })
                  }
                />
              )}
            </div>
          </FormBlock>
          <FormBlock label="About Me" hint="You can use markdown and links if you'd like.">
            <div className="relative">
              <textarea
                aria-label="About Me"
                value={d.bio}
                maxLength={190}
                rows={4}
                onChange={(e) => set('bio', e.target.value)}
                className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-[15px] text-fg outline-none focus:border-brand"
              />
              <span className="absolute bottom-2 right-3 text-xs text-fg-subtle">{190 - d.bio.length}</span>
            </div>
          </FormBlock>
        </div>
        <ProfilePreview me={me} d={d} />
      </div>
      <SaveBar visible={dirty} saving={saving} onReset={() => setD(initial)} onSave={() => void save()} />
    </>
  );
}

function BeaconProfileForm({ me, initialBeacon }: { me: SelfUser; initialBeacon?: string }) {
  const beacons = useStore(useShallow((s) => s.beaconOrder.map((id) => s.beacons[id]).filter(Boolean)));
  const [beaconId, setBeaconId] = useState(initialBeacon ?? beacons[0]?.id ?? '');
  const member = useStore((s) => (s.me ? s.members[beaconId]?.[s.me.id] : undefined));
  const loaded = useStore((s) => !!s.members[beaconId]);
  useEffect(() => {
    if (beaconId && !loaded) void loadBeacon(beaconId).catch(() => {});
  }, [beaconId, loaded]);
  const initial = useMemo(
    () => ({
      nickname: member?.nickname ?? '',
      pronouns: member?.pronouns ?? '',
      bio: member?.bio ?? '',
      avatarUrl: member?.avatarUrl ?? null,
    }),
    [member?.nickname, member?.pronouns, member?.bio, member?.avatarUrl],
  );
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(initial), [initial, beaconId]);

  // Only send what changed: the API checks CHANGE_NICKNAME whenever a nickname is present.
  const changes: Record<string, string | null> = {};
  if (f.nickname !== initial.nickname) changes.nickname = f.nickname.trim() || null;
  if (f.pronouns !== initial.pronouns) changes.pronouns = f.pronouns.trim() || null;
  if (f.bio !== initial.bio) changes.bio = f.bio.trim() || null;
  if (f.avatarUrl !== initial.avatarUrl) changes.avatarUrl = f.avatarUrl;
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await http.patch(`/beacons/${beaconId}/members/@me`, changes);
      setState((s) => {
        const cur = s.me ? s.members[beaconId]?.[s.me.id] : undefined;
        if (!cur || !s.me) return {};
        return {
          members: {
            ...s.members,
            [beaconId]: {
              ...s.members[beaconId],
              [s.me.id]: { ...cur, ...changes },
            },
          },
        };
      });
      toast(`${term('beacon')} profile saved`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!beacons.length)
    return (
      <p className="text-fg-muted">
        Join a {term('beacon').toLowerCase()} to set a {term('beacon').toLowerCase()} profile.
      </p>
    );

  const base = draftFrom(me as any);
  const preview: ProfileDraft = {
    ...base,
    displayName: f.nickname || base.displayName,
    pronouns: f.pronouns || base.pronouns,
    bio: f.bio || base.bio,
    avatarUrl: f.avatarUrl ?? base.avatarUrl,
  };

  return (
    <>
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <FormBlock label={`Choose a ${term('beacon').toLowerCase()}`}>
            <SelectField label={term('beacon')} value={beaconId} onChange={setBeaconId}>
              {beacons.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
          </FormBlock>
          {!loaded ? (
            <p className="py-6 text-sm text-fg-muted">Loading your {term('beacon').toLowerCase()} profile…</p>
          ) : (
            <>
              <FormBlock label="Nickname" hint="Leave a field empty to use your main profile.">
                <Input
                  value={f.nickname}
                  maxLength={32}
                  onChange={(e) => setF({ ...f, nickname: e.target.value })}
                  placeholder={me.displayName || me.username}
                  aria-label="Nickname"
                />
              </FormBlock>
              <FormBlock label="Pronouns">
                <Input
                  value={f.pronouns}
                  maxLength={40}
                  onChange={(e) => setF({ ...f, pronouns: e.target.value })}
                  placeholder={me.pronouns || 'Add your pronouns'}
                  aria-label="Pronouns"
                />
              </FormBlock>
              <FormBlock label={`${term('beacon')} Avatar`}>
                <ImageControls noun="Avatar" value={f.avatarUrl} onChange={(v) => setF({ ...f, avatarUrl: v })} purpose="avatar" />
              </FormBlock>
              <FormBlock label="About Me">
                <textarea
                  aria-label="About Me"
                  value={f.bio}
                  maxLength={190}
                  rows={3}
                  onChange={(e) => setF({ ...f, bio: e.target.value })}
                  placeholder={me.bio || ''}
                  className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-[15px] text-fg outline-none placeholder:text-fg-subtle focus:border-brand"
                />
              </FormBlock>
            </>
          )}
        </div>
        <ProfilePreview me={me} d={preview} />
      </div>
      <SaveBar visible={dirty} saving={saving} onReset={() => setF(initial)} onSave={() => void save()} />
    </>
  );
}

function ProfilesTab({ me, view: initialView, initialBeacon }: { me: SelfUser; view: 'user' | 'beacon'; initialBeacon?: string }) {
  useWideSettingsPage();
  const [view, setView] = useState(initialView);
  useEffect(() => setView(initialView), [initialView]);
  return (
    <>
      <div role="tablist" className="mb-8 flex gap-6 border-b border-line">
        {(
          [
            ['user', 'User Profile'],
            ['beacon', `${term('beacon')} Profiles`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={clsx('-mb-px border-b-2 pb-3 text-[15px] font-medium', view === id ? 'border-brand-sky text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'user' ? <UserProfileForm me={me} /> : <BeaconProfileForm me={me} initialBeacon={initialBeacon} />}
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

const STATUSES: Presence[] = ['online', 'idle', 'dnd', 'invisible'];

function StatusTab({ me }: { me: SelfUser }) {
  const current = useStore((s) => s.presence[me.id]?.customStatus ?? me.customStatus);
  const presence = useStore((s) => s.presence[me.id]?.status ?? 'online');
  const [text, setText] = useState(current?.text ?? '');
  const [emoji, setEmoji] = useState(current?.emoji ?? '');
  const [clear, setClear] = useState(0);

  const save = async (status: CustomStatus | null) => {
    try {
      await http.patch('/users/@me/status', { customStatus: status });
      setState((s) => ({
        presence: {
          ...s.presence,
          [me.id]: {
            status: s.presence[me.id]?.status ?? 'online',
            customStatus: status,
          },
        },
      }));
      if (!status) {
        setText('');
        setEmoji('');
      }
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
      <SettingsSection id="custom-status" title="Custom Status" description="Shown under your name in member lists and on your profile.">
        <Field label="What's cookin'?">
          <div className="flex gap-2">
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 8))}
              aria-label="Status emoji"
              placeholder="🛰️"
              className="h-10 w-14 rounded-md border border-line bg-void text-center text-xl outline-none focus:border-brand"
            />
            <div className="flex-1">
              <Input value={text} maxLength={128} onChange={(e) => setText(e.target.value)} placeholder="Support has arrived!" aria-label="Status text" />
            </div>
          </div>
        </Field>
        <Field label="Clear after">
          <SelectField label="Clear after" value={clear} onChange={(v) => setClear(Number(v))}>
            {CLEAR_AFTER.map((c, i) => (
              <option key={c.label} value={i}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </Field>
        <div className="flex gap-3">
          <Button onClick={submit}>Save Status</Button>
          {(current?.text || current?.emoji) && (
            <Button variant="secondary" onClick={() => void save(null)}>
              Clear Status
            </Button>
          )}
        </div>
      </SettingsSection>
      <SettingsSection id="online-status" title="Online Status">
        <div role="radiogroup" aria-label="Online status" className="space-y-2">
          {STATUSES.map((st) => {
            const on = presence === st;
            return (
              <button
                key={st}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMyPresence(st)}
                className={clsx('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left', on ? 'border-brand bg-brand/10' : 'border-line bg-raised hover:bg-hover')}
              >
                <PresenceDot status={st} size={12} ring="transparent" />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-fg">{PRESENCE_LABELS[st].label}</span>
                  {PRESENCE_LABELS[st].description && <span className="block text-sm text-fg-muted">{PRESENCE_LABELS[st].description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// Data & privacy, notifications, voice, appearance, keybinds
// ---------------------------------------------------------------------------

function PrivacyTab({ me }: { me: SelfUser & Record<string, any> }) {
  const [visibility, setVisibility] = useState<string>(me.profileVisibility ?? 'everyone');
  const save = async (v: string) => {
    const prev = visibility;
    setVisibility(v);
    try {
      await http.patch('/users/@me/profile', { profileVisibility: v });
    } catch (e) {
      setVisibility(prev);
      toast((e as Error).message, 'error');
    }
  };
  return (
    <>
      <SettingsSection
        id="profile-visibility"
        title="Profile Visibility"
        description="Who can view your full profile. This never affects who can send you transmissions or affiliation requests."
      >
        <RadioList
          label="Profile visibility"
          value={visibility}
          onChange={(v) => void save(v)}
          options={[
            { value: 'everyone', label: 'Everyone' },
            {
              value: 'beacons',
              label: `Members of your ${term('beacon', true).toLowerCase()}`,
            },
            { value: 'friends', label: `${term('affiliate', true)} only` },
          ]}
        />
      </SettingsSection>
      <SettingsSection id="safety" title="Safety">
        <ComingSoon className="flex w-full [&>*]:flex-1">
          <div>
            <Switch label={`Allow ${term('link', true).toLowerCase()} from ${term('beacon').toLowerCase()} members`} checked onChange={() => {}} />
            <Switch label="Filter explicit media" checked onChange={() => {}} />
          </div>
        </ComingSoon>
      </SettingsSection>
    </>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState(readNotifyPrefs);
  const [permission, setPermission] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const defaultSetting = useStore((s) => s.notificationSettings['global:@global']);
  const update = (p: typeof prefs) => {
    setPrefs(p);
    writeNotifyPrefs(p);
  };
  return (
    <>
      <SettingsSection id="desktop" title="Desktop & Sounds">
        <Switch
          label="Enable Desktop Notifications"
          description={permission === 'denied' ? 'Your browser has blocked notifications for this site.' : 'Get notified about transmissions while Subspace is in the background.'}
          checked={prefs.desktop && permission === 'granted'}
          onChange={async (v) => {
            if (v && permission !== 'granted') setPermission(await requestDesktopPermission());
            update({ ...prefs, desktop: v });
          }}
        />
        <Switch
          label="Notification Sounds"
          description="Play a ping when a notification arrives."
          checked={prefs.sounds}
          onChange={(v) => {
            update({ ...prefs, sounds: v });
            if (v) playPing();
          }}
        />
      </SettingsSection>
      <SettingsSection
        id="default-level"
        title={`Default for new ${term('beacon', true).toLowerCase()}`}
        description={`Each ${term('beacon').toLowerCase()} can override this from its menu under Notification Settings. ${term('link', true)} always notify unless muted.`}
      >
        <RadioList
          label="Default notification level"
          value={defaultSetting?.level && defaultSetting.level !== 'inherit' ? defaultSetting.level : 'mentions'}
          onChange={(v) =>
            void setNotificationSetting('global', '@global', {
              level: v as any,
            })
          }
          options={[
            { value: 'all', label: 'All Transmissions' },
            { value: 'mentions', label: 'Only @mentions' },
            { value: 'nothing', label: 'Nothing' },
          ]}
        />
      </SettingsSection>
    </>
  );
}

function VoiceTab() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('subspace_av_devices') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => {});
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
      <SelectField label={label} value={prefs[key] ?? 'default'} onChange={(v) => set(key, v)}>
        <option value="default">Default</option>
        {devices
          .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId)
          .map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${kind} ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
      </SelectField>
    </Field>
  );
  return (
    <>
      <SettingsSection id="voice" title="Voice">
        <div className="grid grid-cols-2 gap-4">
          {pick('audioinput', 'audioInput', 'Input Device')}
          {pick('audiooutput', 'audioOutput', 'Output Device')}
        </div>
        <Switch label="Echo Cancellation" description="Always on." checked disabled onChange={() => {}} />
        <Switch label="Noise Suppression" description="Always on." checked disabled onChange={() => {}} />
        <ComingSoon className="flex w-full [&>*]:flex-1">
          <div>
            <Switch label="Mic Test and Input Sensitivity" checked={false} onChange={() => {}} />
          </div>
        </ComingSoon>
      </SettingsSection>
      <SettingsSection id="video" title="Video">
        {pick('videoinput', 'videoInput', 'Camera')}
      </SettingsSection>
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
      <SettingsSection id="theme" title="Theme" description="Subspace is dark by design.">
        <div className="flex gap-3">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full ring-2 ring-brand ring-offset-2 ring-offset-base"
            style={{
              background: 'linear-gradient(135deg, var(--color-void) 55%, var(--color-brand) 55%, var(--color-brand-sky))',
            }}
            aria-label="Deep Space (active)"
            title="Deep Space"
          />
          <ComingSoon label="More themes">
            <span className="h-14 w-14 rounded-full bg-[#1E2140]" />
          </ComingSoon>
        </div>
      </SettingsSection>
      <SettingsSection id="scaling" title="Chat Font Scaling">
        <div className="flex items-center gap-4">
          <span className="text-xs text-fg-muted">12px</span>
          <input
            type="range"
            aria-label="Chat font size"
            min={12}
            max={20}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="flex-1 accent-[var(--color-brand)]"
          />
          <span className="text-xs text-fg-muted">20px</span>
        </div>
        <p className="mt-2 text-sm text-fg-muted">Currently {scale}px.</p>
      </SettingsSection>
      <SettingsSection id="display" title="Message Display">
        <ComingSoon className="flex w-full [&>*]:flex-1">
          <div>
            <Switch label="Compact mode" checked={false} onChange={() => {}} />
          </div>
        </ComingSoon>
      </SettingsSection>
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
    <SettingsSection id="keybinds" title="Keybinds" description="Shortcuts available anywhere in Subspace.">
      <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {KEYBINDS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 bg-raised px-4 py-3">
            <dt className="text-[15px] text-fg">{v}</dt>
            <dd>
              <kbd className="whitespace-nowrap rounded-md border border-line-strong bg-void px-2 py-1 font-mono text-xs text-fg">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------

export function UserSettings({ tab: initialTab }: { tab?: string }) {
  const me = useStore((s) => s.me);
  // "beacon-profile[:id]" opens the Profiles page on its beacon tab.
  const beaconProfile = initialTab?.startsWith('beacon-profile');
  const [tab, setTab] = useState(beaconProfile ? 'profile' : (initialTab ?? 'account'));
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
          items: [
            {
              id: 'account',
              icon: <User />,
              label: 'Account',
              children: [
                { id: 'account-info', label: 'Account Info' },
                { id: 'password-security', label: 'Password & Security' },
                { id: 'account-status', label: 'Account Status' },
              ],
            },
            { id: 'profile', icon: <UserPen />, label: 'Profiles' },
            { id: 'status', icon: <Smile />, label: 'Status' },
            { id: 'privacy', icon: <Shield />, label: 'Data & Privacy' },
            { id: 'notifications', icon: <Bell />, label: 'Notifications' },
            {
              id: 'devices',
              icon: <Laptop />,
              label: 'Devices',
              comingSoon: true,
            },
            {
              id: 'connections',
              icon: <Link2 />,
              label: 'Connections',
              comingSoon: true,
            },
          ],
        },
        {
          heading: 'Billing',
          items: [
            {
              id: 'nitro',
              icon: <Sparkles />,
              label: 'Subscriptions',
              comingSoon: true,
            },
            {
              id: 'boost',
              icon: <Rocket />,
              label: `${term('beacon')} Boost`,
              comingSoon: true,
            },
            {
              id: 'gifts',
              icon: <Gift />,
              label: 'Gift Inventory',
              comingSoon: true,
            },
            {
              id: 'billing',
              icon: <CreditCard />,
              label: 'Billing',
              comingSoon: true,
            },
          ],
        },
        {
          heading: 'Experience',
          items: [
            { id: 'voice', icon: <Mic />, label: 'Voice & Video' },
            { id: 'appearance', icon: <Palette />, label: 'Appearance' },
            { id: 'keybinds', icon: <Keyboard />, label: 'Keybinds' },
            {
              id: 'accessibility',
              icon: <Accessibility />,
              label: 'Accessibility',
              comingSoon: true,
            },
            {
              id: 'language',
              icon: <Languages />,
              label: 'Language & Time',
              comingSoon: true,
            },
            {
              id: 'authorized',
              icon: <KeyRound />,
              label: 'Authorized Apps',
              comingSoon: true,
            },
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
      {tab === 'profile' && <ProfilesTab me={me} view={beaconProfile ? 'beacon' : 'user'} initialBeacon={initialBeacon} />}
      {tab === 'status' && <StatusTab me={me} />}
      {tab === 'privacy' && <PrivacyTab me={me as any} />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'keybinds' && <KeybindsTab />}
    </SettingsLayout>
  );
}
