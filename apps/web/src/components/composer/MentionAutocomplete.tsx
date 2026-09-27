import React, { useEffect, useState } from 'react';
import { Hash, Volume2, Archive, Users, Shield } from 'lucide-react';

export interface MentionItem {
  id: string;
  type: 'user' | 'channel' | 'special';
  name: string;
  subtitle?: string;
  avatar?: string;
  channelType?: 'text' | 'voice' | 'forum';
  color?: string;
}

interface MentionAutocompleteProps {
  isOpen: boolean;
  type: 'user' | 'channel' | null;
  filter: string;
  items: MentionItem[];
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
}

export const MentionAutocomplete: React.FC<MentionAutocompleteProps> = ({
  isOpen,
  type,
  filter,
  items,
  onSelect,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredItems = items
    .filter(item => item.name.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 8);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter, type]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % (filteredItems.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredItems.length) % (filteredItems.length || 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredItems[selectedIndex]) {
          e.preventDefault();
          onSelect(filteredItems[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onSelect, onClose]);

  if (!isOpen || filteredItems.length === 0) return null;

  return (
    <div 
      className="absolute bottom-full left-0 mb-2 w-72 max-h-60 bg-[#111214] border border-[#1f2024] rounded-[8px] shadow-2xl overflow-y-auto z-50 p-1.5 animate-in fade-in zoom-in-95"
      role="listbox"
      aria-label="Mentions list"
    >
      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#949ba4]">
        {type === 'user' ? 'MEMBERS & ROLES' : 'CHANNELS'}
      </div>
      {filteredItems.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-[6px] cursor-pointer transition-colors ${
              isSelected ? 'bg-[#2b2d31] text-white' : 'text-[#dbdee1] hover:bg-[#1a1b1e]'
            }`}
          >
            {item.type === 'user' ? (
              item.avatar ? (
                <span className="w-6 h-6 rounded-full bg-[#1e1f22] flex items-center justify-center text-sm">
                  {item.avatar}
                </span>
              ) : (
                <Shield className="w-4 h-4 text-[#00f0ff]" />
              )
            ) : item.type === 'special' ? (
              <Users className="w-4 h-4 text-[#eb459e]" />
            ) : (
              item.channelType === 'voice' ? (
                <Volume2 className="w-4 h-4 text-[#949ba4]" />
              ) : item.channelType === 'forum' ? (
                <Archive className="w-4 h-4 text-[#949ba4]" />
              ) : (
                <Hash className="w-4 h-4 text-[#949ba4]" />
              )
            )}

            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold truncate" style={{ color: item.color || undefined }}>
                {type === 'user' ? `@${item.name}` : `#${item.name}`}
              </span>
              {item.subtitle && (
                <span className="text-[10px] text-[#949ba4] truncate">{item.subtitle}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
