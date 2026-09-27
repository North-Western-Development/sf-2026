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
      <div className="flex flex-col h-full text-xs text-[#dbdee1] select-none">
        {submitted ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-[#23a55a]" />
            <h3 className="text-base font-bold text-white">Incident Flare Dispatched</h3>
            <p className="text-xs text-[#949ba4] max-w-sm">
              Your report has been prioritized in the Command Staff triage queue with frozen evidence telemetry.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="bg-[#f23f43]/10 border border-[#f23f43]/30 rounded-[8px] p-3 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-[#f23f43] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-white text-xs">Flag Violation of Subspace Directives</h4>
                  <p className="text-[11px] text-[#dbdee1] mt-0.5">
                    Flagging <span className="font-semibold text-white">{targetType}</span>: <span className="font-mono text-[#00f0ff]">{targetLabel}</span>.
                    Telemetry state and message content will be permanently snapshotted.
                  </p>
                </div>
              </div>

              {snippet && (
                <div className="bg-[#080809] border border-[#1f2024] p-3 rounded-[6px] space-y-1">
                  <div className="text-[10px] uppercase font-bold text-[#80848e] flex items-center gap-1">
                    <Lock className="w-3 h-3 text-[#00f0ff]" /> Frozen Evidence Snapshot
                  </div>
                  <div className="text-xs text-white font-mono bg-[#111214] p-2 rounded max-h-24 overflow-y-auto select-text">
                    "{snippet}"
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider block">
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
                          ? 'border-[#00f0ff] bg-[#00f0ff]/10 text-white font-semibold'
                          : 'border-[#1f2024] bg-[#0b0c0e] text-[#949ba4] hover:border-[#35363c]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider block">
                  Additional Tactical Details (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide context or explanation for instance operators..."
                  className="w-full h-20 bg-[#0b0c0e] border border-[#1f2024] rounded-[6px] p-2.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none"
                />
              </div>

              {error && (
                <div className="p-2 rounded bg-[#f23f43]/20 border border-[#f23f43] text-[#f23f43] text-xs">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#1f2024]">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-[4px] text-xs font-semibold text-[#dbdee1] hover:underline"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-[4px] text-xs font-semibold bg-[#f23f43] hover:bg-[#da373b] text-white transition-colors"
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
