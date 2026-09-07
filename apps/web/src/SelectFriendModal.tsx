import React, { useState } from 'react';
import { Modal, UserProfile } from '@subspace/ui';
import { Search, MessageSquare } from 'lucide-react';
import { FriendItem } from './App';

interface SelectFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  friends: FriendItem[];
  onSelectFriend: (friend: UserProfile) => void;
}

export const SelectFriendModal: React.FC<SelectFriendModalProps> = ({
  isOpen,
  onClose,
  friends,
  onSelectFriend,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredFriends = friends.filter(f =>
    f.user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.user.callsign.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Operative"
      description="Choose an operative from your trusted frequency list to establish a direct quantum transmission link."
      maxWidth="md"
    >
      <div className="space-y-4 select-none text-[#dbdee1]">
        {/* Search input */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#80848e] absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by operative callsign or name..."
            className="w-full bg-[#0b0c0e] border border-[#1f2024] rounded-[8px] pl-9 pr-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] transition-colors"
          />
        </div>

        {/* Friends List */}
        <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
          {filteredFriends.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#80848e]">
              No operatives found matching your search.
            </div>
          ) : (
            filteredFriends.map((f) => (
              <div
                key={f.id}
                onClick={() => {
                  onSelectFriend(f.user);
                  onClose();
                }}
                className="flex items-center justify-between p-2.5 rounded-[8px] hover:bg-[#16171a] cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-sm">
                      {f.user.avatar}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0b0c0e] ${
                      f.user.status === 'online' ? 'bg-[#23a55a]' :
                      f.user.status === 'idle' ? 'bg-[#f0b232]' :
                      f.user.status === 'dnd' ? 'bg-[#f23f43]' : 'bg-[#80848e]'
                    }`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                      <span>{f.user.name}</span>
                      <span className="text-[11px] text-[#80848e] font-normal">@{f.user.callsign}</span>
                    </div>
                    <div className="text-[10px] text-[#949ba4] truncate">
                      {f.customActivity || f.user.statusText || 'Subspace Operative'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="px-3 py-1.5 rounded-[6px] text-xs font-semibold bg-[#1a1b1e] group-hover:bg-[#5865f2] text-white transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Transmit</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
};
