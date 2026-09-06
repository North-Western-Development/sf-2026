import React from 'react';
import { Shield, Key, Clock, MessageSquare, Copy, Edit3, CheckCircle2 } from 'lucide-react';

export interface UserProfile {
  id: string;
  name: string;
  callsign: string;
  avatar: string;
  status: 'online' | 'idle' | 'dnd' | 'ghost';
  statusText?: string;
  staffRank?: number;
  roles?: string[];
  bannerGradient?: string;
  bio?: string;
  memberSince?: string;
  quantumKeyFingerprint?: string;
  isSelf?: boolean;
}

interface ProfileCardProps {
  user: UserProfile;
  onSendMessage?: (userId: string) => void;
  onStatusChange?: (newStatus: UserProfile['status']) => void;
  onClose?: () => void;
  hideRoles?: boolean;
  onEditProfile?: () => void;
  onCopyId?: (id: string) => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  user,
  onSendMessage,
  onStatusChange,
  hideRoles,
  onEditProfile,
  onCopyId,
}) => {
  const getStatusBg = (status: UserProfile['status']) => {
    switch (status) {
      case 'online': return 'bg-[#23a55a]';
      case 'idle': return 'bg-[#f0b232]';
      case 'dnd': return 'bg-[#f23f43]';
      case 'ghost': return 'bg-[#80848e]';
    }
  };

  const getStatusLabel = (status: UserProfile['status']) => {
    switch (status) {
      case 'online': return 'Online';
      case 'idle': return 'Idle';
      case 'dnd': return 'Do Not Disturb';
      case 'ghost': return 'Invisible (Ghost Mode)';
    }
  };

  return (
    <div className="w-[340px] bg-[#232428] rounded-[16px] shadow-[0_12px_32px_rgba(0,0,0,0.6)] overflow-hidden text-left select-none text-[#dbdee1] animate-in fade-in zoom-in-95 duration-150 border border-[#111214]">
      {/* Banner */}
      <div 
        className="h-28 w-full relative"
        style={{
          background: user.bannerGradient || 'linear-gradient(135deg, #00f0ff 0%, #5865f2 50%, #111214 100%)',
        }}
      >
        {user.staffRank && user.staffRank > 0 && (
          <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-[#00f0ff]/40 text-[10px] font-mono font-bold text-[#00f0ff] uppercase flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {user.staffRank === 3 ? 'Root Staff' : user.staffRank === 2 ? 'Admin' : 'Moderator'}
          </div>
        )}
      </div>

      {/* Avatar & Header */}
      <div className="px-4 pb-4 relative">
        <div className="flex justify-between items-end -mt-12 mb-3">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-[#111214] border-[6px] border-[#232428] flex items-center justify-center text-3xl shadow-xl">
              {user.avatar}
            </div>
            <span 
              className={`absolute bottom-0 right-0 w-6 h-6 rounded-full border-[4px] border-[#232428] shadow-md ${getStatusBg(user.status)}`}
              title={`Status: ${getStatusLabel(user.status)}`}
            />
          </div>

          <div className="flex gap-2">
            {onSendMessage && !user.isSelf && (
              <button
                type="button"
                onClick={() => onSendMessage(user.id)}
                className="bg-[#5865f2] hover:bg-[#4752c4] text-white px-3 py-1.5 rounded-[4px] text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <MessageSquare className="w-3.5 h-3.5" /> Direct Comm
              </button>
            )}
          </div>
        </div>

        {/* User Identity & Badges */}
        <div className="bg-[#111214] rounded-[8px] p-3 space-y-3">
          <div>
            <h3 className="text-lg font-bold text-white leading-tight flex items-center gap-1.5">
              {user.name}
              {user.staffRank && user.staffRank >= 2 && <Shield className="w-4 h-4 text-[#00f0ff]" />}
            </h3>
            <div className="text-xs text-[#949ba4] font-medium mt-0.5">@{user.callsign}</div>
          </div>

          {/* Custom Status Speech Bubble */}
          {user.statusText && (
            <div className="relative text-xs text-[#f2f3f5] bg-[#2b2d31] px-3 py-2 rounded-[8px] border border-[#35373c] shadow-sm">
              <span className="italic font-normal">"{user.statusText}"</span>
            </div>
          )}

          {/* Bio */}
          {user.bio && (
            <div className="pt-2 border-t border-[#232428] text-xs text-[#b5bac1] leading-relaxed">
              <div className="text-[10px] uppercase font-bold text-[#b5bac1] mb-1 tracking-wider">
                ABOUT ME
              </div>
              {user.bio}
            </div>
          )}

          {/* Roles (Hidden on User Island / Self Profile) */}
          {!hideRoles && !user.isSelf && user.roles && user.roles.length > 0 && (
            <div className="pt-2 border-t border-[#232428]">
              <div className="text-[10px] uppercase font-bold text-[#b5bac1] mb-1.5 tracking-wider">
                ROLES
              </div>
              <div className="flex flex-wrap gap-1">
                {user.roles.map((r, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-[4px] bg-[#2b2d31] text-[11px] font-medium text-[#00f0ff] flex items-center gap-1"
                  >
                    <span className="w-2 h-2 rounded-full bg-[#00f0ff]" />
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key & Timestamp info */}
          <div className="pt-2 border-t border-[#232428] space-y-1 text-[11px] font-mono text-[#949ba4]">
            {user.quantumKeyFingerprint && (
              <div className="flex items-center gap-1.5 truncate">
                <Key className="w-3.5 h-3.5 text-[#00f0ff] shrink-0" />
                <span>{user.quantumKeyFingerprint}</span>
              </div>
            )}
            {user.memberSince && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Enlisted: {user.memberSince}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions (Self Island or Other Member) */}
        {user.isSelf ? (
          <div className="mt-3 space-y-2">
            {onEditProfile && (
              <button
                type="button"
                onClick={onEditProfile}
                className="w-full bg-[#2b2d31] hover:bg-[#35373c] text-white py-1.5 rounded-[4px] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-[#35373c]"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#00f0ff]" /> Edit Profile
              </button>
            )}

            {onStatusChange && (
              <div className="space-y-1 pt-1 border-t border-[#232428]">
                <div className="text-[10px] uppercase font-bold text-[#949ba4] px-1 mb-1">
                  STATUS PRESENCE
                </div>
                {(['online', 'idle', 'dnd', 'ghost'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => onStatusChange(st)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-xs font-medium transition-colors ${
                      user.status === st ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${getStatusBg(st)}`} />
                      <span>{getStatusLabel(st)}</span>
                    </div>
                    {user.status === st && <CheckCircle2 className="w-3.5 h-3.5 text-[#23a55a]" />}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (onCopyId) onCopyId(user.id);
                else navigator.clipboard?.writeText(user.id);
              }}
              className="w-full bg-[#2b2d31] hover:bg-[#35373c] text-xs text-[#949ba4] hover:text-white py-1.5 rounded-[4px] font-medium flex items-center justify-center gap-1.5 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copy User ID
            </button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            {onSendMessage && (
              <button
                type="button"
                onClick={() => onSendMessage(user.id)}
                className="flex-1 bg-[#5865f2] hover:bg-[#4752c4] text-xs text-white py-1.5 rounded-[4px] font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" /> Send Message
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (onCopyId) onCopyId(user.id);
                else navigator.clipboard?.writeText(user.id);
              }}
              className="px-3 bg-[#2b2d31] hover:bg-[#35373c] text-xs text-[#dbdee1] py-1.5 rounded-[4px] font-medium flex items-center justify-center gap-1.5 transition-colors"
              title="Copy User ID"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
