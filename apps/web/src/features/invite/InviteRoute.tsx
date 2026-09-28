import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@subspace/ui';
import { http, ApiError } from '../../lib/http';
import { acceptInvite } from '../../data/actions';
import { useStore } from '../../data/store';
import { AuthLayout } from '../auth/AuthLayout';
import { term } from '../../lib/strings';

interface Preview {
  code: string;
  beacon: { id: string; name: string; iconUrl: string | null; description: string | null; memberCount: number; onlineCount: number };
  inviter: { username: string; discriminator: string; displayName: string | null } | null;
}

export function InviteRoute() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alreadyIn = useStore((s) => (preview ? !!s.beacons[preview.beacon.id] : false));

  useEffect(() => {
    http
      .get<Preview>(`/invites/${encodeURIComponent(code)}`)
      .then(setPreview)
      .catch(() => setError('This invite may be expired, or you might not have permission to join.'));
  }, [code]);

  const accept = async () => {
    if (!preview) return;
    if (alreadyIn) return navigate(`/channels/${preview.beacon.id}`);
    setBusy(true);
    try {
      navigate(`/channels/${await acceptInvite(code)}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(code === 'BANNED' ? `You are banned from this ${term('beacon').toLowerCase()}.` : code === 'BLOCKED' ? `You have blocked this ${term('beacon').toLowerCase()}.` : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      {error ? (
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-fg">Invite Invalid</h1>
          <p className="mt-2 text-sm text-fg-muted">{error}</p>
          <Button size="lg" fullWidth className="mt-6" onClick={() => navigate('/channels/@me')}>
            Continue to Subspace
          </Button>
        </div>
      ) : !preview ? (
        <p className="py-10 text-center text-sm text-fg-subtle">Decoding invite…</p>
      ) : (
        <div className="text-center">
          <span className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl bg-raised text-2xl font-bold">
            {preview.beacon.iconUrl ? <img src={preview.beacon.iconUrl} alt="" className="h-full w-full object-cover" /> : preview.beacon.name[0]?.toUpperCase()}
          </span>
          <p className="mt-4 text-sm text-fg-muted">
            {preview.inviter ? `${preview.inviter.displayName || preview.inviter.username} invited you to join` : "You've been invited to join"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-fg">{preview.beacon.name}</h1>
          <p className="mt-2 flex items-center justify-center gap-4 text-sm text-fg-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-online" /> {preview.beacon.onlineCount.toLocaleString()} Online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-offline" /> {preview.beacon.memberCount.toLocaleString()} Members
            </span>
          </p>
          <Button size="lg" fullWidth className="mt-6" onClick={accept} isLoading={busy}>
            {alreadyIn ? `Open ${term('beacon')}` : 'Accept Invite'}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
