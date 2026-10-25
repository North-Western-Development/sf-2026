import { useState } from 'react';
import { Input } from '@subspace/ui';
import { ApiError } from '../../../lib/http';
import { toast } from '../../../app/ui';

/** "Current Password" field for dialogs that change sensitive account details. */
export function CurrentPassword({ value, onChange, error, autoFocus }: { value: string; onChange: (v: string) => void; error: string | null; autoFocus?: boolean }) {
  return (
    <Input
      label="Current Password"
      type="password"
      autoComplete="current-password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error ?? undefined}
      autoFocus={autoFocus}
      required
    />
  );
}

/** Runs a password-gated request: a wrong password shows under the field, anything else is a toast. */
export async function withPassword(run: () => Promise<void>, setPasswordError: (e: string | null) => void, setBusy: (b: boolean) => void) {
  setBusy(true);
  try {
    await run();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PASSWORD_INCORRECT') setPasswordError('Password does not match.');
    else toast((err as Error).message, 'error');
  } finally {
    setBusy(false);
  }
}

export function usePasswordField() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onChange = (v: string) => {
    setPassword(v);
    setError(null);
  };
  return { password, error, setError, onChange };
}
