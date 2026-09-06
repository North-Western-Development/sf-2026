import React from 'react';
import { Smile, CornerUpLeft, Pin, MoreHorizontal } from 'lucide-react';

interface MessageActionBarProps {
  onAddReaction?: (emoji: string) => void;
  onReply?: () => void;
  onPin?: () => void;
  onMore?: (e: React.MouseEvent) => void;
}

export const MessageActionBar: React.FC<MessageActionBarProps> = ({
  onAddReaction,
  onReply,
  onPin,
  onMore,
}) => {
  const quickEmojis = ['👍', '🚀', '⚡', '❤️'];

  return (
    <div className="flex items-center gap-0.5 bg-[#0E1118] border border-[#232936] rounded-xl px-1 py-0.5 shadow-xl backdrop-blur-md">
      {/* Quick Emojis */}
      {quickEmojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddReaction?.(emoji);
          }}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#1C222E] text-sm transition-transform active:scale-90"
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}

      <div className="w-[1px] h-4 bg-[#232936] mx-1" />

      {/* Add Reaction */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddReaction?.('😀');
        }}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-[#00F0FF] hover:bg-[#1C222E] transition-colors"
        title="Add Reaction"
      >
        <Smile className="w-4 h-4" />
      </button>

      {/* Reply */}
      {onReply && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReply();
          }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-[#00F0FF] hover:bg-[#1C222E] transition-colors"
          title="Reply to Transmission"
        >
          <CornerUpLeft className="w-4 h-4" />
        </button>
      )}

      {/* Pin */}
      {onPin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-[#00F0FF] hover:bg-[#1C222E] transition-colors"
          title="Pin Transmission"
        >
          <Pin className="w-4 h-4" />
        </button>
      )}

      {/* More Options */}
      {onMore && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMore(e);
          }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222E] transition-colors"
          title="More Actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
