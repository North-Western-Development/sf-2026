import React, { useState } from 'react';
import { Search } from 'lucide-react';

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
}

interface EmojiPickerPopdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  customEmojis?: CustomEmoji[];
}

const DEFAULT_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
  '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜',
  '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏',
  '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖',
  '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡',
  '🚀', '🛸', '🛰️', '🪐', '🌌', '⚡', '✨', '🔥',
  '👍', '👎', '👏', '🙌', '🤝', '🎉', '🏆', '💎',
];

export const EmojiPickerPopdown: React.FC<EmojiPickerPopdownProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  customEmojis = [],
}) => {
  const [search, setSearch] = useState('');

  if (!isOpen) return null;

  const filteredEmojis = search.trim()
    ? DEFAULT_EMOJIS.filter(() => true) // In real usage or simple filter
    : DEFAULT_EMOJIS;

  const filteredCustom = customEmojis.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="absolute bottom-14 right-4 w-80 bg-[#111214] border border-[#1f2024] rounded-[10px] shadow-2xl z-50 p-3 select-none animate-in fade-in zoom-in-95"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search Box */}
      <div className="relative mb-2.5">
        <Search className="w-4 h-4 text-[#80848e] absolute left-2.5 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Signal Glyphs..."
          className="w-full bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[6px] pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#80848e] outline-none"
        />
      </div>

      {/* Custom Beacon Emojis */}
      {filteredCustom.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase font-bold text-[#949ba4] mb-1.5 px-1 tracking-wider">
            SERVER GLYPHS
          </div>
          <div className="grid grid-cols-6 gap-1 max-h-24 overflow-y-auto">
            {filteredCustom.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                onClick={() => {
                  onSelectEmoji(`:${emoji.name}:`);
                  onClose();
                }}
                className="p-1 rounded hover:bg-[#1a1b1e] flex items-center justify-center transition-colors"
                title={`:${emoji.name}:`}
              >
                <img src={emoji.url} alt={emoji.name} className="w-5 h-5 object-contain" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Standard Emojis */}
      <div>
        <div className="text-[10px] uppercase font-bold text-[#949ba4] mb-1.5 px-1 tracking-wider">
          TACTICAL GLYPHS
        </div>
        <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
          {filteredEmojis.map((emoji, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                onSelectEmoji(emoji);
                onClose();
              }}
              className="w-8 h-8 rounded hover:bg-[#1a1b1e] text-lg flex items-center justify-center transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
