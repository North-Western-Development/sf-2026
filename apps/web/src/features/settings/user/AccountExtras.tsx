import { useEffect, useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { AVATAR_DECORATIONS, PROFILE_EFFECTS } from '@subspace/constants';
import { Button, Input, Modal } from '@subspace/ui';
import { setState } from '../../../data/store';
import { http, optional } from '../../../lib/http';
import { toast } from '../../../app/ui';
import type { SelfUser } from '../../../lib/types';
import { Avatar } from '../../common/Avatar';
import { DECORATION_LABELS, EFFECT_LABELS, AvatarDecoration, ProfileEffect } from '../../common/Decorations';
import { RowButton, SettingsRow } from '../SettingsLayout';
import { CurrentPassword, usePasswordField, withPassword } from './passwordField';
import { SMS_CONSENT } from '../../auth/LegalPages';

const footer = '-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4';

// ---------------------------------------------------------------------------
// Phone number (My Account › Account Info)
// ---------------------------------------------------------------------------

function PhoneDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const pw = usePasswordField();
  const [busy, setBusy] = useState(false);

  const send = (e: FormEvent) => {
    e.preventDefault();
    void withPassword(
      async () => {
        await http.post('/users/@me/phone', { phone, password: pw.password });
        setStep('code');
      },
      pw.setError,
      setBusy
    );
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post('/users/@me/phone/verify', { code });
      const { transmitter } = await http.get<{ transmitter: Partial<SelfUser> }>('/auth/me');
      setState((s) => ({ me: s.me ? { ...s.me, phone: transmitter.phone ?? null } : s.me }));
      toast('Phone number added.', 'success');
      onClose();
    } catch (err) {
      setCodeError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code')
    return (
      <Modal isOpen onClose={onClose} title="Enter the code" description={`We texted a 6-digit code to ${phone}.`} maxWidth="md">
        <form onSubmit={verify} className="space-y-4">
          <Input
            label="Verification Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''));
              setCodeError(null);
            }}
            error={codeError ?? undefined}
            autoFocus
          />
          <div className={footer}>
            <Button variant="link" className="text-fg" onClick={() => setStep('number')}>
              Back
            </Button>
            <Button type="submit" isLoading={busy} disabled={code.length !== 6}>
              Verify
            </Button>
          </div>
        </form>
      </Modal>
    );

  return (
    <Modal isOpen onClose={onClose} title="Enter a phone number" description="You will get a text with a verification code." maxWidth="md">
      <form onSubmit={send} className="space-y-4">
        <Input label="Phone Number" type="tel" autoComplete="tel" placeholder="+1 555 010 0199" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus required />
        <CurrentPassword value={pw.password} onChange={pw.onChange} error={pw.error} />
        {/* Carriers require consent shown where the number is collected (see /sms). */}
        <p data-testid="sms-consent" className="text-xs text-fg-muted">
          {SMS_CONSENT}{' '}
          <a href="/sms" target="_blank" rel="noreferrer" className="text-brand-sky hover:underline">SMS Terms</a> ·{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand-sky hover:underline">Privacy Policy</a>
        </p>
        <div className={footer}>
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!phone.trim() || !pw.password}>
            Send Code
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RemovePhoneDialog({ onClose }: { onClose: () => void }) {
  const pw = usePasswordField();
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void withPassword(
      async () => {
        await http.delete('/users/@me/phone', { password: pw.password });
        setState((s) => ({ me: s.me ? { ...s.me, phone: null } : s.me }));
        toast('Phone number removed.', 'success');
        onClose();
      },
      pw.setError,
      setBusy
    );
  };
  return (
    <Modal isOpen onClose={onClose} title="Remove phone number" description="Beacons with the highest verification level will need two-factor authentication instead." maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <CurrentPassword value={pw.password} onChange={pw.onChange} error={pw.error} autoFocus />
        <div className={footer}>
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" isLoading={busy} disabled={!pw.password}>
            Remove
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function PhoneRow({ me }: { me: SelfUser }) {
  const [dialog, setDialog] = useState<null | 'add' | 'remove'>(null);
  // Off when the server cannot send texts (no Twilio).
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void optional(http.get<{ available: boolean }>('/users/@me/phone/config'), { available: false }).then((r) => setAvailable(r.available));
  }, []);
  return (
    <>
      <SettingsRow
        label="Phone Number"
        value={me.phone || <span className="text-fg-subtle">{available === false ? 'Phone verification is not available on this server' : 'Not added'}</span>}
        action={
          me.phone ? (
            <div className="flex gap-2">
              {available && <RowButton onClick={() => setDialog('add')}>Edit</RowButton>}
              <RowButton danger onClick={() => setDialog('remove')}>
                Remove
              </RowButton>
            </div>
          ) : available ? (
            <RowButton onClick={() => setDialog('add')}>Add</RowButton>
          ) : null
        }
      />
      {dialog === 'add' && <PhoneDialog onClose={() => setDialog(null)} />}
      {dialog === 'remove' && <RemovePhoneDialog onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Account Standing (My Account › Account Status)
// ---------------------------------------------------------------------------

interface Standing {
  status: 'all_good' | 'limited' | 'at_risk' | 'very_limited';
  quarantined: { since: string; reason: string | null } | null;
  violations: Array<{ id: string; kind: 'transmission' | 'account' | 'file'; reason: string; at: string }>;
}

const STANDING: Record<Standing['status'], { label: string; text: string; tone: string; icon: React.ReactNode }> = {
  all_good: { label: 'All good', text: 'Thank you for upholding the Subspace Directives. If you have a violation, it will appear here.', tone: 'text-online', icon: <ShieldCheck className="text-online" /> },
  limited: { label: 'Limited', text: 'Staff acted on something you posted. Violations stop counting after a year.', tone: 'text-warning', icon: <ShieldAlert className="text-warning" /> },
  at_risk: { label: 'At risk', text: 'Several violations in the past year. More may lead to your account being restricted.', tone: 'text-warning', icon: <ShieldAlert className="text-warning" /> },
  very_limited: { label: 'Very limited', text: 'Staff have restricted your account: you can read, but not post, react or speak.', tone: 'text-danger', icon: <ShieldX className="text-danger" /> },
};

const REASON: Record<string, string> = {
  harassment: 'Harassment',
  spam: 'Spam',
  malware: 'Malware',
  illicit_content: 'Illicit content',
  other: 'Breaking the Subspace Directives',
};
const KIND: Record<string, string> = { transmission: 'A transmission you sent', account: 'Your account', file: 'A file you uploaded' };

export function AccountStandingRow() {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void http.get<Standing>('/users/@me/standing').then(setStanding, () => {});
  }, []);
  const look = STANDING[standing?.status ?? 'all_good'];
  return (
    <>
      <SettingsRow
        icon={look.icon}
        label="Account Standing"
        description={look.text}
        value={<span className={look.tone}>{look.label}</span>}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Modal isOpen onClose={() => setOpen(false)} title="Account Standing" maxWidth="md">
          <div data-testid="standing" className="space-y-3">
            <p className={clsx('text-lg font-semibold', look.tone)}>Your account is {look.label.toLowerCase()}</p>
            <p className="text-sm text-fg-muted">{look.text}</p>
            {standing?.quarantined && (
              <p className="rounded-md bg-danger/10 p-3 text-sm text-fg">
                Restricted since {new Date(standing.quarantined.since).toLocaleDateString()}
                {standing.quarantined.reason ? `: ${standing.quarantined.reason}` : ''}
              </p>
            )}
            {standing?.violations.length ? (
              <ul className="divide-y divide-line rounded-md border border-line">
                {standing.violations.map((v) => (
                  <li key={v.id} className="px-3 py-2 text-sm">
                    <p className="font-medium text-fg">{REASON[v.reason] ?? REASON.other}</p>
                    <p className="text-fg-muted">
                      {KIND[v.kind]} · {v.at ? new Date(v.at).toLocaleDateString() : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-subtle">No violations in the past year.</p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Avatar decorations and profile effects (Profiles)
// ---------------------------------------------------------------------------

function PickerModal({
  title,
  options,
  value,
  onApply,
  onClose,
  render,
}: {
  title: string;
  options: readonly string[];
  value: string | null;
  onApply: (v: string | null) => void;
  onClose: () => void;
  render: (name: string | null) => React.ReactNode;
}) {
  const [pick, setPick] = useState<string | null>(value);
  const labels = title.includes('Decoration') ? DECORATION_LABELS : EFFECT_LABELS;
  return (
    <Modal isOpen onClose={onClose} title={title} maxWidth="lg">
      <div role="radiogroup" aria-label={title} className="grid grid-cols-3 gap-3">
        {[null, ...options].map((name) => (
          <button
            key={name ?? 'none'}
            type="button"
            role="radio"
            aria-checked={pick === name}
            aria-label={name ? labels[name] : 'None'}
            onClick={() => setPick(name)}
            className={clsx(
              'flex flex-col items-center gap-2 rounded-lg border-2 bg-raised p-3 text-sm text-fg hover:bg-hover',
              pick === name ? 'border-brand' : 'border-transparent'
            )}
          >
            {render(name)}
            {name ? labels[name] : 'None'}
          </button>
        ))}
      </div>
      <div className={footer}>
        <Button variant="link" className="text-fg" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            onApply(pick);
            onClose();
          }}
        >
          Apply
        </Button>
      </div>
    </Modal>
  );
}

export function DecorationPicker({ me, avatarUrl, value, onChange }: { me: SelfUser; avatarUrl: string | null; value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>
          Change Decoration
        </Button>
        {value && (
          <Button size="sm" variant="link" className="text-fg" onClick={() => onChange(null)}>
            Remove Decoration
          </Button>
        )}
      </div>
      {open && (
        <PickerModal
          title="Change Decoration"
          options={AVATAR_DECORATIONS}
          value={value}
          onApply={onChange}
          onClose={() => setOpen(false)}
          render={(name) => (
            <span className="relative my-2 inline-flex">
              <Avatar user={{ ...me, avatarUrl }} size={56} decoration={false} />
              <AvatarDecoration name={name} size={56} />
            </span>
          )}
        />
      )}
    </>
  );
}

export function EffectPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>
          Change Effect
        </Button>
        {value && (
          <Button size="sm" variant="link" className="text-fg" onClick={() => onChange(null)}>
            Remove Effect
          </Button>
        )}
      </div>
      {open && (
        <PickerModal
          title="Change Effect"
          options={PROFILE_EFFECTS}
          value={value}
          onApply={onChange}
          onClose={() => setOpen(false)}
          render={(name) => (
            <span className="relative block h-20 w-full overflow-hidden rounded-md bg-overlay">
              <ProfileEffect name={name} />
            </span>
          )}
        />
      )}
    </>
  );
}
