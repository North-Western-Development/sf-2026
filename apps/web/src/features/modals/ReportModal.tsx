import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { RadioList } from '../settings/SettingsLayout';

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

/** Report flow (Discord's "What's the issue?" dialog): pick a reason, add details, submit to instance staff. */
export function ReportModal({ onClose, targetType, targetId, targetLabel }: { onClose: () => void; targetType: Target; targetId: string; targetLabel: string }) {
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
      await http.post('/reports', { targetType, targetId, reason, description: details.trim() || undefined });
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
            Submit Report
          </Button>
        </div>
      </form>
    </Modal>
  );
}
