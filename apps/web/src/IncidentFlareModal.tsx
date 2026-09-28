import React, { useState } from 'react';
import { ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
import { Modal } from '@subspace/ui';

import { api } from './services/api';
interface IncidentFlareModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'transmission' | 'transmitter' | 'beacon';
  targetId: string;
  targetLabel: string;
  snippet?: string;
}

export const IncidentFlareModal: React.FC<IncidentFlareModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetLabel,
  snippet,
}) => {
  const [reason, setReason] = useState<'harassment' | 'spam' | 'malware' | 'illicit_content' | 'other'>('harassment');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.request('/api/v1/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          description: description.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Report submission failed' }));
        throw new Error(err.error || 'Failed to submit report');
      }

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err.message || 'Report dispatch failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dispatch Incident Flare" fixedDimensions={true}>
      <div className="flex flex-col h-full text-xs text-fg select-none">
        {submitted ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-online" />
            <h3 className="text-base font-bold text-fg">Incident Flare Dispatched</h3>
            <p className="text-xs text-fg-muted max-w-sm">
              Your report has been prioritized in the Command Staff triage queue with frozen evidence telemetry.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="bg-danger/10 border border-danger/30 rounded-[8px] p-3 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-fg text-xs">Flag Violation of Subspace Directives</h4>
                  <p className="text-[11px] text-fg mt-0.5">
                    Flagging <span className="font-semibold text-fg">{targetType}</span>: <span className="font-mono text-brand-sky">{targetLabel}</span>.
                    Telemetry state and message content will be permanently snapshotted.
                  </p>
                </div>
              </div>

              {snippet && (
                <div className="bg-base border border-line p-3 rounded-[6px] space-y-1">
                  <div className="text-[10px] uppercase font-bold text-fg-subtle flex items-center gap-1">
                    <Lock className="w-3 h-3 text-brand-sky" /> Frozen Evidence Snapshot
                  </div>
                  <div className="text-xs text-fg font-mono bg-raised p-2 rounded max-h-24 overflow-y-auto select-text">
                    "{snippet}"
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-fg-muted tracking-wider block">
                  Violation Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'harassment', label: 'Harassment or Abuse' },
                    { id: 'spam', label: 'Spam or Signal Flooding' },
                    { id: 'malware', label: 'Malicious Links or Payloads' },
                    { id: 'illicit_content', label: 'Illicit or Prohibited Data' },
                    { id: 'other', label: 'Other Directives Violation' },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.id}
                      onClick={() => setReason(opt.id as any)}
                      className={`text-left p-2.5 rounded-[6px] border text-xs transition-colors ${
                        reason === opt.id
                          ? 'border-brand bg-brand/10 text-fg font-semibold'
                          : 'border-line bg-base text-fg-muted hover:border-line-strong'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-fg-muted tracking-wider block">
                  Additional Tactical Details (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide context or explanation for instance operators..."
                  className="w-full h-20 bg-base border border-line rounded-[6px] p-2.5 text-xs text-fg placeholder-fg-subtle focus:outline-none focus:border-brand resize-none"
                />
              </div>

              {error && (
                <div className="p-2 rounded bg-danger/20 border border-danger text-danger text-xs">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-[4px] text-xs font-semibold text-fg hover:underline"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-[4px] text-xs font-semibold bg-danger hover:bg-danger text-fg transition-colors"
              >
                {isSubmitting ? 'Dispatching...' : 'Dispatch Flare'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
