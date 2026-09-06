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
    <div className="flex items-center bg-[#313338] border border-[#232428] rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.3)] p-0.5 text-[#b5bac1]">
      {/* Quick Emojis */}
      {quickEmojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddReaction?.(emoji);
          }}
          className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:bg-[#35373c] hover:text-white text-sm transition-all active:scale-95"
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}

      <div className="w-[1px] h-4 bg-[#3f4147] mx-1" />

      {/* Add Reaction */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddReaction?.('😀');
        }}
        className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:text-white hover:bg-[#35373c] transition-colors"
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
          className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:text-white hover:bg-[#35373c] transition-colors"
          title="Reply"
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
          className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:text-white hover:bg-[#35373c] transition-colors"
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
          className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:text-white hover:bg-[#35373c] transition-colors"
          title="More"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
