import { useState, type FormEvent } from 'react';
import { CheckCircle2, LockOpen } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { RadioList } from '../settings/SettingsLayout';
import { getState } from '../../data/store';
import { isEncryptedChannel } from '../../data/e2ee';
import { decryptTransmission, type EncryptedPayload } from '../../lib/e2ee/client';
import { parseChannelKey, type ChannelKey } from '../../lib/types';

type Reason = 'harassment' | 'spam' | 'malware' | 'illicit_content' | 'other';
type Target = 'transmission' | 'transmitter' | 'beacon';

const REASONS: Array<{ value: Reason; label: string; description: string }> = [
  { value: 'harassment', label: 'Harassment or abuse', description: 'Threats, hate, bullying, or targeting someone.' },
  { value: 'spam', label: 'Spam', description: 'Flooding, scams, or unwanted promotion.' },
  { value: 'malware', label: 'Malicious links or files', description: 'Phishing, malware, or links that steal accounts.' },
  { value: 'illicit_content', label: 'Illegal or prohibited content', description: 'Content the Subspace Directives do not allow.' },
  { value: 'other', label: 'Something else', description: 'Tell staff what is wrong in the details below.' },
];

const TITLES: Record<Target, string> = {
  transmission: 'Report Transmission',
  transmitter: 'Report Transmitter',
  beacon: `Report ${term('beacon')}`,
};

/** Transmissions shared on each side of a reported encrypted one (REPORT_CONTEXT on the API). */
const CONTEXT = 5;

interface Reveal {
  id: string;
  text: string;
  attachments?: Array<{ url: string; key: string; filename: string; mimeType: string; size: number }>;
  fk?: string;
}

/**
 * What this device can show staff of an encrypted conversation around a reported transmission:
 * each one it can open, with its franking key, so the server can check it is what was sent.
 */
async function revealAround(channel: ChannelKey, targetId: string): Promise<Reveal[]> {
  const me = getState().me;
  if (!me) throw new Error('Not signed in');
  const { type, id } = parseChannelKey(channel);
  const { transmissions } = await http.get<{ transmissions: Array<{ id: string; author: { id: string }; editedAt?: string | null; encrypted?: EncryptedPayload | null }> }>(
    `/channels/${type}/${id}/transmissions?around=${targetId}&limit=${2 * CONTEXT}`
  );
  const reveals: Reveal[] = [];
  for (const t of transmissions) {
    if (!t.encrypted || reveals.some((r) => r.id === t.id)) continue;
    const opened = await decryptTransmission(me.id, t.id, t.author.id, t.encrypted, t.editedAt ?? '');
    if (!opened.ok) continue;
    const { text, attachments, fk } = opened.plain;
    reveals.push({ id: t.id, text, ...(attachments?.length ? { attachments: attachments.map(({ url, key, filename, mimeType, size }) => ({ url, key, filename, mimeType, size })) } : {}), ...(fk ? { fk } : {}) });
  }
  if (!reveals.some((r) => r.id === targetId)) throw new Error('This device cannot open that transmission, so it cannot be reported from here.');
  return reveals;
}

/**
 * Report flow (Discord's "What's the issue?" dialog): pick a reason, add details, submit to instance staff.
 * In an end-to-end encrypted conversation staff cannot read anything, so the person is told that the
 * transmission and up to five on each side go to staff in plain text, and the client sends them.
 */
export function ReportModal({ onClose, targetType, targetId, targetLabel, channel }: { onClose: () => void; targetType: Target; targetId: string; targetLabel: string; channel?: ChannelKey }) {
  const encrypted = targetType === 'transmission' && !!channel && isEncryptedChannel(channel);
  const [reason, setReason] = useState<Reason>('harassment');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reveals = encrypted ? await revealAround(channel!, targetId) : undefined;
      await http.post('/reports', { targetType, targetId, reason, description: details.trim() || undefined, ...(reveals ? { reveals } : {}) });
      setSent(true);
    } catch (err) {
      setError((err as Error).message || 'The report could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Modal isOpen onClose={onClose} title="Thanks for reporting" maxWidth="md">
        <div className="flex flex-col items-center py-2 text-center">
          <CheckCircle2 className="h-12 w-12 text-online" />
          <p className="mt-3 text-sm text-fg-muted">Instance staff will review your report. A snapshot of what you reported was saved with it, so it can be reviewed even if it is edited or deleted.</p>
        </div>
        <div className="-mx-6 -mb-4 mt-6 flex justify-end bg-raised px-6 py-4">
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title={TITLES[targetType]} description={<>Reporting <span className="font-semibold text-fg">{targetLabel}</span>. What's the issue?</>} maxWidth="md">
      <form onSubmit={submit}>
        <RadioList label="Reason" value={reason} onChange={setReason} options={REASONS} />
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-fg-muted">Details (optional)</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1000}
            rows={3}
            aria-label="Details"
            placeholder="Anything that helps staff understand what happened"
            className="w-full resize-none rounded-md bg-void px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:ring-2 focus:ring-brand"
          />
        </label>
        {encrypted && (
          <div role="note" aria-label="Encrypted conversation" className="mt-4 flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
            <LockOpen className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <p>
              This conversation is end-to-end encrypted, so instance staff cannot read it. Reporting shares this transmission and up to {CONTEXT} before and {CONTEXT} after it,
              with any attachments, <span className="font-semibold">in plain text</span> with this instance's staff. The server checks that they are exactly what was sent.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" isLoading={busy}>
            {encrypted ? 'Share and Report' : 'Submit Report'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
