import React, { useState } from 'react';
import { ShieldAlert, CheckCircle, AlertTriangle } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { api } from './services/api';

interface UploadDisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccepted: () => void;
}

export const UploadDisclaimerModal: React.FC<UploadDisclaimerModalProps> = ({
  isOpen,
  onClose,
  onAccepted,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!acknowledged) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.acceptUploadDisclaimer();
      onAccepted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to accept upload disclaimer. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Subspace Vault Upload Policy">
      <div className="space-y-4 text-xs select-none">
        <div className="bg-[#f23f43]/10 border border-[#f23f43]/30 rounded-[8px] p-3.5 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-[#f23f43] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-white tracking-wide">First-Time Upload Disclaimer</h4>
            <p className="text-[#dbdee1] leading-relaxed">
              Files uploaded to Subspace Frequency are accessible to anyone with the direct link (with or without an account).
              Instance staff will always have access to review all files. Do not upload sensitive, confidential, or private material.
            </p>
          </div>
        </div>

        <div className="bg-[#111214] border border-[#1f2024] rounded-[8px] p-3 space-y-2 text-[#949ba4]">
          <div className="flex items-center gap-2 text-[#00f0ff] font-semibold">
            <AlertTriangle className="w-4 h-4 text-[#e5a50a]" />
            <span>Public Storage Architecture</span>
          </div>
          <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] leading-normal text-[#dbdee1]">
            <li>Uploaded files are stored in the instance's self-hosted MinIO S3 cluster.</li>
            <li>Direct links bypass channel clearance barriers for fast transmission rendering.</li>
            <li>Reported malicious or abusive payloads are quarantined by instance operators.</li>
          </ul>
        </div>

        {error && (
          <div className="p-2.5 rounded-[6px] bg-[#f23f43]/20 border border-[#f23f43] text-[#f23f43] text-xs">
            {error}
          </div>
        )}

        <label className="flex items-start gap-2.5 p-2.5 rounded-[6px] bg-[#16171a] hover:bg-[#1a1b1e] border border-[#1f2024] cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 rounded border-[#3f4147] text-[#00f0ff] focus:ring-0 bg-[#080809]"
          />
          <span className="text-[11px] text-[#dbdee1] leading-snug">
            I understand that files uploaded to Subspace Vault are public to direct link holders and staff, and I agree not to upload sensitive or prohibited data.
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[6px] text-xs font-semibold text-[#dbdee1] hover:bg-[#1a1b1e] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!acknowledged || isSubmitting}
            onClick={handleConfirm}
            className={`px-4 py-2 rounded-[6px] text-xs font-bold text-white flex items-center gap-1.5 transition-all ${
              acknowledged && !isSubmitting
                ? 'bg-[#23a55a] hover:bg-[#1f9350] shadow-[0_0_12px_rgba(35,165,90,0.4)]'
                : 'bg-[#2b2d31] text-[#949ba4] cursor-not-allowed'
            }`}
          >
            <CheckCircle className="w-4 h-4" />
            <span>{isSubmitting ? 'Acknowledging...' : 'I Acknowledge & Accept'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
