import React, { useState } from 'react';
import { Modal } from '@subspace/ui';
import { Hash, Volume2, Activity } from 'lucide-react';

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryName?: string;
  onCreateChannel: (name: string, type: 'text' | 'voice' | 'announcement', topic?: string) => Promise<void> | void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  onClose,
  categoryName,
  onCreateChannel,
}) => {
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState<'text' | 'voice' | 'announcement'>('text');
  const [topic, setTopic] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const cleanName = channelName.trim().toLowerCase().replace(/\s+/g, '-');
      await onCreateChannel(cleanName, channelType, topic.trim() || undefined);
      setChannelName('');
      setTopic('');
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
      title="Create Channel"
      description={categoryName ? `in ${categoryName}` : 'Add a new communication relay to this beacon'}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 select-none text-[#dbdee1] mt-2">
        {/* Channel Type */}
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-2">
            CHANNEL TYPE
          </label>
          <div className="space-y-2">
            {[
              {
                type: 'text' as const,
                title: 'Text Relay',
                desc: 'Post transmissions, share holo-logs, and quantum coordinates',
                icon: <Hash className="w-5 h-5 text-[#949ba4]" />,
              },
              {
                type: 'voice' as const,
                title: 'Voice Comm-Link',
                desc: 'Real-time audio mesh, video broadcast, and screen shares',
                icon: <Volume2 className="w-5 h-5 text-[#949ba4]" />,
              },
              {
                type: 'announcement' as const,
                title: 'Announcement Band',
                desc: 'Priority broadcast channel for mission-critical alerts',
                icon: <Activity className="w-5 h-5 text-[#949ba4]" />,
              },
            ].map((option) => (
              <label
                key={option.type}
                className={`flex items-center justify-between p-3 rounded-[8px] border cursor-pointer transition-colors ${
                  channelType === option.type
                    ? 'bg-[#1a1b1e] border-[#00f0ff] text-white'
                    : 'bg-[#111214] border-[#1f2024] text-[#949ba4] hover:bg-[#16171a]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {option.icon}
                  <div>
                    <div className="text-sm font-semibold text-white">{option.title}</div>
                    <div className="text-xs text-[#949ba4]">{option.desc}</div>
                  </div>
                </div>
                <input
                  type="radio"
                  name="channelType"
                  value={option.type}
                  checked={channelType === option.type}
                  onChange={() => setChannelType(option.type)}
                  className="accent-[#00f0ff] w-4 h-4 cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Channel Name */}
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-1.5">
            CHANNEL NAME <span className="text-[#f23f43]">*</span>
          </label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-[#949ba4] font-mono text-sm">
              {channelType === 'voice' ? '🔊' : '#'}
            </span>
            <input
              type="text"
              required
              value={channelName}
              onChange={(e) => setChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="new-relay"
              className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/60 rounded-[6px] pl-8 pr-3 py-2 text-sm text-white placeholder-[#80848e] outline-none font-mono"
              maxLength={100}
            />
          </div>
        </div>

        {/* Channel Topic */}
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-1.5">
            TOPIC (OPTIONAL)
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Operational frequency parameters"
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
            disabled={!channelName.trim() || isSubmitting}
            className="bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold px-5 py-2 rounded-[6px] transition-colors shadow-sm"
          >
            {isSubmitting ? 'Creating Relay...' : 'Create Channel'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
