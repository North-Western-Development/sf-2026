import React, { useState } from 'react';
import { Search, Check, X } from 'lucide-react';
import { UserProfile } from '@subspace/ui';

export interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  channelName?: string;
  friends: { id: string; user: UserProfile }[];
  inviteCode?: string;
  onSendInvite?: (friendId: string) => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  onClose,
  serverName,
  channelName = 'rules_and_information',
  friends,
  inviteCode = 'subspace.gg/sf-quantum-7',
  onSendInvite,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [invitedFriends, setInvitedFriends] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleInvite = (friendId: string) => {
    setInvitedFriends(prev => ({ ...prev, [friendId]: true }));
    if (onSendInvite) onSendInvite(friendId);
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(`https://${inviteCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredFriends = friends.filter(f => 
    f.user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.user.callsign.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-[#0b0c0e] border border-[#1f2024] rounded-[14px] shadow-[0_24px_50px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>Invite friends to {serverName}</span>
            </h2>
            <button 
              onClick={onClose}
              className="text-[#949ba4] hover:text-white p-1 rounded hover:bg-[#1a1b1e] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-[#949ba4] mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00f0ff]" />
            <span>Recipients will land in <span className="text-white font-medium">#{channelName}</span></span>
          </p>

          {/* Search Box */}
          <div className="mt-3.5 relative">
            <input
              type="text"
              placeholder="Search for friends"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/50 rounded-[8px] px-3.5 py-2 text-xs text-white placeholder-[#80848e] outline-none transition-colors pr-8"
              autoFocus
            />
            <Search className="w-3.5 h-3.5 text-[#80848e] absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>

        {/* Friends List */}
        <div className="flex-1 max-h-60 overflow-y-auto px-3 py-1 space-y-1">
          {filteredFriends.length === 0 ? (
            <div className="text-center py-6 text-xs text-[#80848e]">
              No friends found matching "{searchQuery}"
            </div>
          ) : (
            filteredFriends.map((f) => {
              const isSent = invitedFriends[f.id];
              return (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-2 rounded-[6px] hover:bg-[#16171a] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#111214] border border-[#1f2024] flex items-center justify-center text-sm shrink-0">
                      {f.user.avatar}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate flex items-center gap-1">
                        <span>{f.user.name}</span>
                      </div>
                      <div className="text-[10px] text-[#949ba4] truncate">
                        @{f.user.callsign}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleInvite(f.id)}
                    disabled={isSent}
                    className={`px-4 py-1.5 rounded-[3px] text-xs font-medium transition-all shrink-0 ${
                      isSent 
                        ? 'border border-[#23a55a] text-[#23a55a] bg-transparent cursor-default'
                        : 'border border-[#23a55a] text-white hover:bg-[#23a55a] bg-transparent'
                    }`}
                  >
                    {isSent ? 'Sent' : 'Invite'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Link Box */}
        <div className="p-4 bg-[#08080a] border-t border-[#1a1b1e]">
          <div className="text-[11px] font-bold text-[#b5bac1] uppercase tracking-wider mb-2">
            OR, SEND A SERVER INVITE LINK TO A FRIEND
          </div>
          <div className="flex items-center gap-2 bg-[#111214] border border-[#1f2024] rounded-[6px] p-1.5 focus-within:border-[#00f0ff]/50">
            <span className="text-xs font-mono text-[#dbdee1] flex-1 px-2 select-all truncate">
              https://{inviteCode}
            </span>
            <button
              onClick={handleCopyLink}
              className={`px-4 py-1.5 rounded-[3px] text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
                copied
                  ? 'bg-[#23a55a] text-white'
                  : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copied
                </>
              ) : (
                'Copy'
              )}
            </button>
          </div>
          <div className="text-[10px] text-[#80848e] mt-2">
            Your invite link will never expire. Edit invite link.
          </div>
        </div>
      </div>
    </div>
  );
};