import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Hash, Volume2 } from 'lucide-react';
import { Button } from '@subspace/ui';
import { http } from '../../lib/http';
import { createBeacon } from '../../data/actions';
import { useStore } from '../../data/store';
import { AuthLayout } from '../auth/AuthLayout';
import { term } from '../../lib/strings';

interface Preview {
  code: string;
  name: string;
  description: string | null;
  usageCount: number;
  snapshot: { relays: Array<{ key: string; name: string; type: string; parentKey: string | null; position: number }>; clearances: Array<{ name: string; color: string; position: number }> };
  source: { name: string; iconUrl: string | null } | null;
}

/** A beacon template's link (Discord's discord.new/…): what it builds, and a button to make it. */
export function TemplateRoute() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http
      .get<{ template: Preview }>(`/templates/${encodeURIComponent(code)}`)
      .then((r) => setPreview(r.template))
      .catch(() => setError(true));
  }, [code]);

  const create = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      navigate(`/channels/${await createBeacon(`${me?.displayName || me?.username}'s ${preview.name}`, null, { templateCode: preview.code })}`);
    } finally {
      setBusy(false);
    }
  };

  const bands = preview?.snapshot.relays.filter((r) => r.type === 'category').sort((a, b) => a.position - b.position) ?? [];
  const under = (key: string | null) => preview?.snapshot.relays.filter((r) => r.type !== 'category' && r.parentKey === key).sort((a, b) => a.position - b.position) ?? [];
  return (
    <AuthLayout>
      {error ? (
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-fg">Template Not Found</h1>
          <p className="mt-2 text-sm text-fg-muted">This template link is invalid or was deleted.</p>
          <Button size="lg" fullWidth className="mt-6" onClick={() => navigate('/channels/@me')}>
            Continue to Subspace
          </Button>
        </div>
      ) : !preview ? (
        <p className="py-10 text-center text-sm text-fg-subtle">Loading template…</p>
      ) : (
        <div>
          <p className="text-center text-sm text-fg-muted">Create a {term('beacon').toLowerCase()} from a template</p>
          <h1 className="mt-1 text-center text-2xl font-semibold text-fg">{preview.name}</h1>
          {preview.description && <p className="mt-1 text-center text-sm text-fg-muted">{preview.description}</p>}
          <div aria-label="Template preview" className="mt-4 max-h-64 overflow-y-auto rounded-lg bg-void p-3 text-sm">
            {under(null).map((r) => (
              <p key={r.key} className="flex items-center gap-1.5 py-0.5 text-fg-muted">
                {r.type === 'comm_link' ? <Volume2 className="h-4 w-4" /> : <Hash className="h-4 w-4" />} {r.name}
              </p>
            ))}
            {bands.map((b) => (
              <div key={b.key} className="mt-2">
                <p className="text-xs font-bold uppercase text-fg-subtle">{b.name}</p>
                {under(b.key).map((r) => (
                  <p key={r.key} className="flex items-center gap-1.5 py-0.5 text-fg-muted">
                    {r.type === 'comm_link' ? <Volume2 className="h-4 w-4" /> : <Hash className="h-4 w-4" />} {r.name}
                  </p>
                ))}
              </div>
            ))}
          </div>
          {preview.snapshot.clearances.length > 1 && (
            <p className="mt-3 text-sm text-fg-muted">
              {term('clearance', true)}: {preview.snapshot.clearances.filter((c) => c.position > 0).map((c) => c.name).join(', ')}
            </p>
          )}
          <p className="mt-2 text-xs text-fg-subtle">Used {preview.usageCount} time{preview.usageCount === 1 ? '' : 's'}</p>
          <Button size="lg" fullWidth className="mt-6" onClick={() => void create()} isLoading={busy}>
            Create {term('beacon')}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
