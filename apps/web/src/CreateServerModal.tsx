import React, { useState } from 'react';
import { Modal } from '@subspace/ui';
import { Radio, Users, Gamepad2, Sparkles } from 'lucide-react';

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateServer: (name: string, description?: string) => Promise<void> | void;
}

export const CreateServerModal: React.FC<CreateServerModalProps> = ({
  isOpen,
  onClose,
  onCreateServer,
}) => {
  const [serverName, setServerName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState<'custom' | 'gaming' | 'friends' | 'study'>('custom');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onCreateServer(serverName.trim(), description.trim() || undefined);
      setServerName('');
      setDescription('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Your Beacon Server"
      description="Your beacon is where you and your crew communicate via high-frequency relays."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 select-none text-[#dbdee1] mt-2">
        {/* Template Selector */}
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-2">
            START FROM A TEMPLATE
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'gaming', label: 'Fleet & Gaming', icon: <Gamepad2 className="w-4 h-4 text-[#00f0ff]" /> },
              { id: 'friends', label: 'Crew & Friends', icon: <Users className="w-4 h-4 text-[#23a55a]" /> },
              { id: 'custom', label: 'Create My Own', icon: <Sparkles className="w-4 h-4 text-[#f0b232]" /> },
            ].map((tmpl) => (
              <button
                type="button"
                key={tmpl.id}
                onClick={() => {
                  setTemplate(tmpl.id as any);
                  if (tmpl.id === 'gaming' && !serverName) setServerName("Fleet Commander's Station");
                  if (tmpl.id === 'friends' && !serverName) setServerName("Orbital Hangout");
                }}
                className={`p-2.5 rounded-[8px] border text-left flex flex-col gap-1.5 transition-colors ${
                  template === tmpl.id
                    ? 'bg-[#1a1b1e] border-[#00f0ff] text-white'
                    : 'bg-[#111214] border-[#1f2024] text-[#949ba4] hover:bg-[#16171a]'
                }`}
              >
                {tmpl.icon}
                <span className="text-xs font-semibold text-white">{tmpl.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Beacon Name Input */}
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-1.5">
            SERVER NAME <span className="text-[#f23f43]">*</span>
          </label>
          <input
            type="text"
            required
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder="e.g. USS Andromeda Ops"
            className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/60 rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#80848e] outline-none"
            maxLength={100}
          />
        </div>

        {/* Optional Description */}
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-1.5">
            FREQUENCY BROADCAST TOPIC (OPTIONAL)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tactical orbital comms & subspace telemetry"
            className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/60 rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#80848e] outline-none"
            maxLength={250}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-[#1f2024]">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[#949ba4] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!serverName.trim() || isSubmitting}
            className="bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold px-5 py-2 rounded-[6px] transition-colors shadow-sm flex items-center gap-1.5"
          >
            <Radio className="w-3.5 h-3.5" />
            {isSubmitting ? 'Establishing Beacon...' : 'Create Beacon'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
