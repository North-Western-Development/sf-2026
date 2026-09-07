import React, { useState } from 'react';
import { 
  X, 
  Shield, 
  MessageSquare, 
  UserPlus, 
  UserCheck, 
  MoreVertical,
  Award,
  Zap,
  Sparkles,
  Terminal,
  Users
} from 'lucide-react';
import { UserProfile, UserBadgeItem } from '@subspace/ui';

interface FullProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: UserProfile | null;
  onSendMessage?: (userId: string) => void;
  onToggleFriend?: (userId: string) => void;
}

export const FullProfileModal: React.FC<FullProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  onSendMessage,
  onToggleFriend,
}) => {
  const [activeTab, setActiveTab] = useState<'activity' | 'mutualFriends' | 'mutualServers'>('activity');
  const [isFriend, setIsFriend] = useState(Boolean(user?.isFriend));

  if (!isOpen || !user) return null;

  const defaultBadges: UserBadgeItem[] = user.badges || [
    ...(user.staffRank && user.staffRank >= 2 ? [
      { id: 'b-staff', name: 'Command Staff', description: 'Authorized officer on tactical command networks', tier: 'staff' as const, earnedDate: 'Cycle 2024' }
    ] : []),
    { id: 'b-qkd', name: 'Quantum Pioneer', description: 'Subspace quantum double-ratchet synchronized transmitter', tier: 'quantum' as const, earnedDate: 'Cycle 2025' },
    { id: 'b-nitro', name: 'Orbital Subspace Booster', description: 'Boosting subspace beacons since 6/18/26', tier: 'bronze' as const, earnedDate: 'Jun 18, 2026' },
  ];

  const getBadgeIcon = (tier?: string) => {
    switch (tier) {
      case 'staff': return <Shield className="w-3.5 h-3.5 text-[#00f0ff]" />;
      case 'quantum': return <Zap className="w-3.5 h-3.5 text-[#7928ca]" />;
      case 'gold': return <Award className="w-3.5 h-3.5 text-[#f0b232]" />;
      case 'bronze': return <Sparkles className="w-3.5 h-3.5 text-[#eb459e]" />;
      default: return <Terminal className="w-3.5 h-3.5 text-[#23a55a]" />;
    }
  };

  const getStatusBg = (status: UserProfile['status']) => {
    switch (status) {
      case 'online': return 'bg-[#23a55a]';
      case 'idle': return 'bg-[#f0b232]';
      case 'dnd': return 'bg-[#f23f43]';
      case 'ghost': return 'bg-[#80848e]';
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="relative w-[780px] h-[580px] max-w-[95vw] max-h-[90vh] bg-[#000000] border border-[#1e1f22] rounded-[16px] shadow-[0_24px_60px_rgba(0,0,0,0.95)] overflow-hidden flex text-[#dbdee1] select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-50 p-1.5 rounded-full bg-[#111214]/80 hover:bg-[#1f2024] text-[#949ba4] hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Left Identity Column (Replicating media_1788738691460.png) */}
        <div className="w-[340px] bg-[#0b0c0e] border-r border-[#1a1b1e] flex flex-col shrink-0 overflow-y-auto">
          {/* Banner */}
          <div 
            className="h-32 w-full relative shrink-0"
            style={{
              background: user.bannerGradient || 'linear-gradient(135deg, #0b0c0e 0%, #1a1a24 50%, #00f0ff22 100%)',
            }}
          />

          {/* Identity Body */}
          <div className="px-5 pb-6 -mt-14 relative flex-1">
            {/* Avatar & Presence */}
            <div className="relative inline-block mb-3">
              <div className="w-24 h-24 rounded-full bg-[#000000] border-[6px] border-[#0b0c0e] flex items-center justify-center text-4xl shadow-2xl">
                {user.avatar}
              </div>
              <span 
                className={`absolute bottom-1 right-1 w-6 h-6 rounded-full border-[4px] border-[#0b0c0e] shadow-md ${getStatusBg(user.status)}`}
              />
            </div>

            {/* Display Name & Callsign */}
            <div className="mb-2">
              <h2 className="text-xl font-bold text-white leading-tight flex items-center gap-1.5">
                {user.name}
                {user.staffRank && user.staffRank >= 2 && <Shield className="w-4 h-4 text-[#00f0ff]" />}
              </h2>
              <div className="text-xs text-[#949ba4] font-medium mt-0.5">
                @{user.callsign}{user.discriminator ? `#${user.discriminator}` : ''}
              </div>

              {/* Compact Badges Row */}
              {defaultBadges.length > 0 && (
                <div className="flex items-center gap-1 mt-2.5">
                  <div className="bg-[#111214] border border-[#1f2024] rounded-[6px] px-1.5 py-0.5 flex items-center gap-1.5">
                    {defaultBadges.map((b) => (
                      <span key={b.id} title={b.name} className="p-0.5 rounded hover:bg-[#1a1b1e]">
                        {getBadgeIcon(b.tier)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 my-4">
              {onSendMessage && !user.isSelf && (
                <button
                  type="button"
                  onClick={() => onSendMessage(user.id)}
                  className="flex-1 bg-[#5865f2] hover:bg-[#4752c4] text-white py-1.5 rounded-[4px] text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Message
                </button>
              )}
              {!user.isSelf && (
                <button
                  type="button"
                  onClick={() => {
                    setIsFriend(!isFriend);
                    if (onToggleFriend) onToggleFriend(user.id);
                  }}
                  className={`p-1.5 rounded-[4px] text-xs font-semibold border transition-colors ${
                    isFriend
                      ? 'bg-[#23a55a]/15 text-[#23a55a] border-[#23a55a]/40'
                      : 'bg-[#1e1f22] text-[#dbdee1] border-[#2b2d31] hover:bg-[#2b2d31]'
                  }`}
                  title={isFriend ? 'Friends' : 'Add Friend'}
                >
                  {isFriend ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                className="p-1.5 rounded-[4px] bg-[#1e1f22] hover:bg-[#2b2d31] text-[#dbdee1] border border-[#2b2d31]"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>

            {/* Timestamps & Info */}
            <div className="space-y-3 pt-3 border-t border-[#1f2024] text-xs">
              <div>
                <div className="text-[10px] font-bold uppercase text-[#949ba4] tracking-wider mb-1">
                  MEMBER SINCE
                </div>
                <div className="text-white text-xs font-medium">
                  {user.memberSince || 'Oct 1, 2025'}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase text-[#949ba4] tracking-wider mb-1">
                  FRIENDS SINCE
                </div>
                <div className="text-white text-xs font-medium">
                  {user.friendsSince || 'Jul 31, 2026'}
                </div>
              </div>

              {user.quantumKeyFingerprint && (
                <div>
                  <div className="text-[10px] font-bold uppercase text-[#949ba4] tracking-wider mb-1">
                    QUANTUM KEY FINGERPRINT
                  </div>
                  <div className="text-[#00f0ff] font-mono text-[11px] truncate">
                    {user.quantumKeyFingerprint}
                  </div>
                </div>
              )}

              {/* Full 500 Character Bio */}
              <div>
                <div className="text-[10px] font-bold uppercase text-[#949ba4] tracking-wider mb-1">
                  ABOUT ME
                </div>
                <div className="text-xs text-[#dbdee1] leading-relaxed max-h-36 overflow-y-auto bg-[#111214] p-2.5 rounded-[6px] border border-[#1f2024] whitespace-pre-wrap">
                  {user.bio || 'Commander operating across deep-space frequencies and quantum relays.'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Tabbed Pane (Activity, Mutual Friends, Mutual Servers) */}
        <div className="flex-1 bg-[#000000] flex flex-col min-w-0">
          {/* Tabs Navigation */}
          <div className="h-12 px-6 border-b border-[#1a1b1e] flex items-center gap-6 text-sm font-semibold">
            <button
              onClick={() => setActiveTab('activity')}
              className={`h-full flex items-center border-b-2 transition-colors ${
                activeTab === 'activity'
                  ? 'border-[#5865f2] text-white'
                  : 'border-transparent text-[#949ba4] hover:text-[#dbdee1]'
              }`}
            >
              Activity
            </button>
            <button
              onClick={() => setActiveTab('mutualFriends')}
              className={`h-full flex items-center border-b-2 transition-colors ${
                activeTab === 'mutualFriends'
                  ? 'border-[#5865f2] text-white'
                  : 'border-transparent text-[#949ba4] hover:text-[#dbdee1]'
              }`}
            >
              Mutual Friends
            </button>
            <button
              onClick={() => setActiveTab('mutualServers')}
              className={`h-full flex items-center border-b-2 transition-colors ${
                activeTab === 'mutualServers'
                  ? 'border-[#5865f2] text-white'
                  : 'border-transparent text-[#949ba4] hover:text-[#dbdee1]'
              }`}
            >
              Mutual Servers
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'activity' && (
              <div className="space-y-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">
                  CURRENT ACTIVITY
                </div>
                {/* Active Voice/Call Stage Card matching media_1788738691460.png */}
                <div className="p-4 rounded-[12px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-[#1a1b1e] border border-[#2b2d31] flex items-center justify-center text-xl">
                      📞
                    </div>
                    <div>
                      <div className="text-xs text-[#23a55a] font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" />
                        In a call
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5">{user.name}</div>
                    </div>
                  </div>
                  <button className="bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs font-semibold px-4 py-1.5 rounded-[4px] transition-colors">
                    Open
                  </button>
                </div>

                <div className="text-[11px] font-bold uppercase tracking-wider text-[#949ba4] mt-6">
                  RECENT ACTIVITY
                </div>
                <div className="p-3.5 rounded-[12px] bg-[#111214] border border-[#1f2024] flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[8px] bg-[#1a1b1e] flex items-center justify-center text-lg">
                    🎵
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">Paved with Resolve</div>
                    <div className="text-[11px] text-[#949ba4] truncate">Subspace Audio Stream • 1d ago</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'mutualFriends' && (
              <div className="flex flex-col items-center justify-center py-12 text-center text-[#80848e]">
                <Users className="w-12 h-12 mb-2 stroke-1 text-[#2b2d31]" />
                <div className="text-sm font-semibold text-[#949ba4]">No Mutual Friends</div>
                <div className="text-xs mt-1">You and {user.name} don't share any direct links yet.</div>
              </div>
            )}

            {activeTab === 'mutualServers' && (
              <div className="space-y-2">
                {[
                  { name: 'Orbital Fleet Command', icon: '🚀', members: 42 },
                  { name: 'North Western Gaming', icon: '🌌', members: 128 },
                ].map((s, idx) => (
                  <div key={idx} className="p-3 rounded-[8px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#1a1b1e] flex items-center justify-center text-base">
                        {s.icon}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">{s.name}</div>
                        <div className="text-[10px] text-[#949ba4]">{s.members} members</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
