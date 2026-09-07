import React from 'react';
import { Pin, X } from 'lucide-react';

interface PinnedMessage {
  id: string;
  author: string;
  avatar: string;
  content: string;
  timestamp: string;
}

interface PinnedMessagesPopdownProps {
  isOpen: boolean;
  onClose: () => void;
  pinnedMessages: PinnedMessage[];
  onUnpin?: (messageId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}

export const PinnedMessagesPopdown: React.FC<PinnedMessagesPopdownProps> = ({
  isOpen,
  onClose,
  pinnedMessages,
  onUnpin,
  onJumpToMessage,
}) => {
  if (!isOpen) return null;

  return (
    <div 
      className="absolute top-12 right-4 w-[420px] bg-[#111214] border border-[#1f2024] rounded-[10px] shadow-[0_16px_36px_rgba(0,0,0,0.9)] z-50 overflow-hidden flex flex-col text-[#dbdee1] select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1a1b1e] flex items-center justify-between bg-[#0b0c0e]">
        <div className="flex items-center gap-2 font-bold text-sm text-white">
          <Pin className="w-4 h-4 text-[#00f0ff]" />
          <span>Pinned Messages</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[400px] overflow-y-auto p-4">
        {pinnedMessages.length === 0 ? (
          /* Empty Graphic matching media_1788737618872.png */
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-20 h-20 rounded-full bg-[#1a1b1e] border border-[#2b2d31] flex items-center justify-center relative mb-4">
              <span className="text-3xl">📌</span>
            </div>
            <h4 className="text-sm font-semibold text-white mb-1">
              This channel doesn't have any pinned messages... yet.
            </h4>
            <div className="mt-6 pt-3 border-t border-[#1a1b1e] text-[11px] text-[#949ba4] leading-relaxed">
              <span className="text-[#23a55a] font-bold tracking-wider">PROTIP:</span> Users with the 'Pin Messages' clearance can pin a transmission from its context menu.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {pinnedMessages.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-[8px] bg-[#0b0c0e] border border-[#1f2024] hover:border-[#00f0ff]/40 transition-colors group relative"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-white">{m.author}</span>
                    <span className="text-[10px] text-[#80848e]">{m.timestamp}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onJumpToMessage && (
                      <button
                        onClick={() => onJumpToMessage(m.id)}
                        className="text-[10px] text-[#00f0ff] hover:underline px-1.5 py-0.5"
                      >
                        Jump
                      </button>
                    )}
                    {onUnpin && (
                      <button
                        onClick={() => onUnpin(m.id)}
                        className="p-1 hover:text-[#f23f43] rounded"
                        title="Unpin"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-[#dbdee1] leading-relaxed break-words select-text">
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
