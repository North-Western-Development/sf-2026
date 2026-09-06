import React from 'react';
import { Shield, Radio, Key, Clock, MessageSquare, AlertTriangle } from 'lucide-react';
import { Button } from './Button.js';

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
}

interface ProfileCardProps {
  user: UserProfile;
  onSendMessage?: (userId: string) => void;
  onViewFullDossier?: (userId: string) => void;
  onClose?: () => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  user,
  onSendMessage,
  onViewFullDossier,
  onClose,
}) => {
  const getStatusColor = (status: UserProfile['status']) => {
    switch (status) {
      case 'online': return '#00FF88';
      case 'idle': return '#FFB800';
      case 'dnd': return '#FF3366';
      case 'ghost': return '#64748B';
    }
  };

  return (
    <div className="w-[300px] bg-[#0E1118] border border-[#232936] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] overflow-hidden text-left select-none animate-in fade-in zoom-in-95 duration-100">
      {/* Banner */}
      <div 
        className="h-20 w-full relative"
        style={{
          background: user.bannerGradient || 'linear-gradient(135deg, #00F0FF 0%, #7928CA 50%, #07090E 100%)',
        }}
      >
        {user.staffRank && user.staffRank > 0 && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-[#00F0FF]/40 text-[10px] font-mono font-bold text-[#00F0FF] uppercase flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {user.staffRank === 3 ? 'Root Staff' : user.staffRank === 2 ? 'Admin' : 'Moderator'}
          </div>
        )}
      </div>

      {/* Avatar & Status Header */}
      <div className="px-4 pb-4 relative pt-0">
        <div className="flex justify-between items-end -mt-10 mb-3">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-[#151922] border-4 border-[#0E1118] flex items-center justify-center text-3xl shadow-xl">
              {user.avatar}
            </div>
            <span 
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-4 border-[#0E1118] shadow-md"
              style={{ backgroundColor: getStatusColor(user.status) }}
              title={`Status: ${user.status}`}
            />
          </div>

          <div className="flex gap-2">
            {onSendMessage && (
              <Button
                variant="primary"
                size="sm"
                className="rounded-xl px-3 py-1.5 text-xs flex items-center gap-1.5"
                onClick={() => onSendMessage(user.id)}
              >
                <MessageSquare className="w-3.5 h-3.5" /> Direct Comm
              </Button>
            )}
          </div>
        </div>

        {/* User Identity */}
        <div>
          <h3 className="text-base font-bold text-[#F0F4F8] leading-tight flex items-center gap-1.5">
            {user.name}
            {user.staffRank && user.staffRank >= 2 && <Shield className="w-3.5 h-3.5 text-[#00F0FF]" />}
          </h3>
          <div className="text-xs font-mono text-[#64748B]">@{user.callsign}</div>
          {user.statusText && (
            <div className="mt-2 text-xs text-[#94A3B8] italic bg-[#151922]/60 px-2.5 py-1.5 rounded-lg border border-[#232936]">
              "{user.statusText}"
            </div>
          )}
        </div>

        {/* Bio / Mission Status */}
        {user.bio && (
          <div className="mt-3 pt-3 border-t border-[#232936] text-xs text-[#94A3B8] leading-relaxed">
            {user.bio}
          </div>
        )}

        {/* Roles / Clearances */}
        {user.roles && user.roles.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#232936]">
            <div className="text-[10px] uppercase font-semibold text-[#64748B] mb-1.5 tracking-wider">
              Security Clearances
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((r, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md bg-[#151922] border border-[#232936] text-[11px] font-medium text-[#00F0FF]"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Quantum Fingerprint */}
        {user.quantumKeyFingerprint && (
          <div className="mt-3 pt-3 border-t border-[#232936] flex items-center gap-2 text-[10px] font-mono text-[#64748B]">
            <Key className="w-3.5 h-3.5 text-[#00F0FF] shrink-0" />
            <span className="truncate">Key ID: {user.quantumKeyFingerprint}</span>
          </div>
        )}

        {/* Member Since */}
        {user.memberSince && (
          <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-[#64748B]">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Subspace Enlistment: {user.memberSince}</span>
          </div>
        )}
      </div>
    </div>
  );
};
