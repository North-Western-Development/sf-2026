import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Input } from '@subspace/ui';
import { api, type LoginResult } from '../../services/api';
import { AuthHeading, AuthLayout, FormError } from './AuthLayout';
import { DirectivesList } from './DirectivesList';

type Mode = 'login' | 'register' | 'two-factor';

const USERNAME_PATTERN = /^[a-z0-9_.]{2,32}$/;

function describeError(err: unknown): string {
  const e = err as { code?: string; message?: string; status?: number };
  switch (e?.code) {
    case 'AMBIGUOUS_USERNAME':
      return 'More than one transmitter uses that username. Sign in with your full tag (name#1234) or email.';
    case 'TRANSMITTER_SUSPENDED':
      return 'This account has been suspended by Command Staff.';
    case 'DISCRIMINATOR_POOL_EXHAUSTED':
      return 'That username has no free tags left. Try a different username.';
  }
  if (e?.status === 401) return 'Those credentials do not match an account.';
  if (e?.status === 503) return 'The Subspace network is unavailable. Try again shortly.';
  return e?.message || 'Something went wrong. Try again.';
}

export function AuthScreen({ onAuthenticated, initialMode = 'login' }: { onAuthenticated: (result: LoginResult & { kind: 'session' }) => void; initialMode?: 'login' | 'register' }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  const handleResult = (result: LoginResult) => {
    if (result.kind === '2fa') {
      setChallengeToken(result.challengeToken);
      setMode('two-factor');
    } else {
      onAuthenticated(result);
    }
  };

  return (
    <AuthLayout wide={mode === 'register'}>
      {mode === 'login' && <LoginForm onResult={handleResult} onRegister={() => setMode('register')} />}
      {mode === 'register' && <RegisterForm onResult={handleResult} onLogin={() => setMode('login')} />}
      {mode === 'two-factor' && challengeToken && (
        <TwoFactorForm
          challengeToken={challengeToken}
          onResult={handleResult}
          onCancel={() => {
            setChallengeToken(null);
            setMode('login');
          }}
        />
      )}
    </AuthLayout>
  );
}

function LoginForm({ onResult, onRegister }: { onResult: (r: LoginResult) => void; onRegister: () => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [method, setMethod] = useState<'password' | 'passkey'>('password');

  const signIn = async (reactivate = false, via = method) => {
    setError(null);
    setBusy(true);
    setMethod(via);
    try {
      onResult(via === 'passkey' ? await api.loginWithPasskey({ reactivate }) : await api.login(identifier.trim(), password, { reactivate }));
    } catch (err) {
      const e = err as { code?: string; name?: string };
      if (e.code === 'ACCOUNT_DISABLED') setDisabled(true);
      else if (e.name === 'NotAllowedError' || e.name === 'AbortError') setError(null);
      else if (e.code === 'PASSKEY_UNKNOWN') setError('That passkey is not linked to an account here.');
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void signIn();
  };

  if (disabled) {
    return (
      <div>
        <AuthHeading title="Account Disabled" subtitle="You disabled this account. Restore it to pick up right where you left off." />
        <Button size="lg" fullWidth isLoading={busy} onClick={() => void signIn(true)}>
          Restore Account
        </Button>
        <Button variant="link" className="mt-4" onClick={() => setDisabled(false)}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <AuthHeading title="Welcome back" subtitle="Your frequency is right where you left it." />
      <FormError message={error} />
      <div className="space-y-4">
        <Input
          label="Email or tag"
          name="identifier"
          autoComplete="username"
          placeholder="name#1234 or you@example.com"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
          data-autofocus
          autoFocus
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" size="lg" fullWidth className="mt-6" isLoading={busy && method === 'password'} disabled={!identifier || !password || busy}>
        Sign in
      </Button>
      {typeof window !== 'undefined' && !!window.PublicKeyCredential && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs uppercase text-fg-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" size="lg" fullWidth isLoading={busy && method === 'passkey'} disabled={busy} onClick={() => void signIn(false, 'passkey')}>
            <KeyRound className="mr-2 h-4 w-4" /> Sign in with a passkey
          </Button>
        </>
      )}
      <p className="mt-4 text-sm text-fg-subtle">
        New to Subspace?{' '}
        <Button variant="link" onClick={onRegister}>
          Create an account
        </Button>
      </p>
    </form>
  );
}

function RegisterForm({ onResult, onLogin }: { onResult: (r: LoginResult) => void; onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameError =
    username && !USERNAME_PATTERN.test(normalizedUsername)
      ? '2-32 characters: letters, numbers, _ and .'
      : undefined;
  const passwordError = password && password.length < 8 ? 'At least 8 characters' : undefined;
  const canSubmit = email && normalizedUsername && !usernameError && password.length >= 8 && accepted;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      onResult(
        await api.register({
          email: email.trim(),
          username: normalizedUsername,
          displayName: displayName.trim() || undefined,
          password,
          acceptDirectives: accepted,
        })
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <AuthHeading title="Create an account" />
      <FormError message={error} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <Input
            label="Display name"
            autoComplete="nickname"
            hint="How others see you. You can change it any time."
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={32}
          />
          <Input
            label="Username"
            autoComplete="username"
            hint={
              normalizedUsername && !usernameError
                ? `You'll get a unique tag like ${normalizedUsername}#0427.`
                : "You'll get a unique 4-digit tag, like name#0427."
            }
            error={usernameError}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={32}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            error={passwordError}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="space-y-4">
          <div role="note" aria-label="Not available in the EU" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
            <p className="font-semibold">Not available in the European Union</p>
            <p className="mt-1 text-fg-muted">
              Subspace Frequency is not authorized for use in the EU or EEA, because it does not comply with the GDPR. Do not create an account if you
              are located there.
            </p>
          </div>

          <section className="rounded-lg border border-line bg-raised p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-3">Subspace Directives</p>
            <div className="max-h-40 overflow-y-auto pr-1 md:max-h-52">
              <DirectivesList />
            </div>
            <label className="mt-4 flex items-start gap-2.5 cursor-pointer text-sm text-fg">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
              />
              <span>
                I have read and accept the Subspace Directives, the{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="text-brand-sky hover:underline">Terms of Service</a> and the{' '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand-sky hover:underline">Privacy Policy</a>.
              </span>
            </label>
          </section>
        </div>
      </div>
      <Button type="submit" size="lg" fullWidth className="mt-6" isLoading={busy} disabled={!canSubmit}>
        Continue
      </Button>
      <p className="mt-4 text-sm">
        <Button variant="link" onClick={onLogin}>
          Already have an account?
        </Button>
      </p>
    </form>
  );
}

function TwoFactorForm({
  challengeToken,
  onResult,
  onCancel,
}: {
  challengeToken: string;
  onResult: (r: LoginResult) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onResult(await api.completeTwoFactor(challengeToken, useBackup ? code.trim().toUpperCase() : code.trim(), useBackup));
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 401 ? 'That sign-in attempt expired. Start again.' : 'That code is not valid.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <AuthHeading
        title="Two-factor authentication"
        subtitle={useBackup ? 'Enter one of your 8-character backup codes.' : 'Enter the 6-digit code from your authenticator app.'}
      />
      <FormError message={error} />
      <Input
        key={useBackup ? 'backup' : 'totp'}
        label={useBackup ? 'Backup code' : 'Authentication code'}
        inputMode={useBackup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        maxLength={useBackup ? 16 : 6}
        value={code}
        onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, ''))}
        className="text-center tracking-[0.4em] font-mono text-lg h-12"
        autoFocus
      />
      <Button type="submit" size="lg" fullWidth className="mt-6" isLoading={busy} disabled={!code}>
        Verify
      </Button>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Button
          variant="link"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {useBackup ? 'Use authenticator code' : 'Use a backup code'}
        </Button>
        <Button variant="link" className="text-fg-muted" onClick={onCancel}>
          Back to sign in
        </Button>
      </div>
    </form>
  );
}
