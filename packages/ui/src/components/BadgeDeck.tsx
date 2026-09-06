import React from 'react';
import { Award, Shield, Lock } from 'lucide-react';

export interface BadgeItem {
  id: string;
  name: string;
  description: string;
  icon?: string;
  tier?: 'bronze' | 'silver' | 'gold' | 'quantum' | 'staff';
  isStaffLocked?: boolean;
}

export interface BadgeDeckProps {
  badges: BadgeItem[];
  userStaffRank?: number; // 0: None, 1: Mod, 2: Admin, 3: Root
  onSelectBadge?: (badge: BadgeItem) => void;
  selectedBadgeId?: string;
}

export const BadgeDeck: React.FC<BadgeDeckProps> = ({
  badges,
  userStaffRank = 0,
  onSelectBadge,
  selectedBadgeId,
}) => {
  const getTierColor = (tier: BadgeItem['tier']) => {
    switch (tier) {
      case 'quantum':
        return 'border-[#00F0FF] bg-[#00F0FF]/10 text-[#00F0FF] shadow-[0_0_12px_rgba(0,240,255,0.2)]';
      case 'staff':
        return 'border-[#FF3366] bg-[#FF3366]/10 text-[#FF3366] shadow-[0_0_12px_rgba(255,51,102,0.2)]';
      case 'gold':
        return 'border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800] shadow-[0_0_12px_rgba(255,184,0,0.2)]';
      case 'silver':
        return 'border-slate-300 bg-slate-300/10 text-slate-300';
      case 'bronze':
      default:
        return 'border-amber-700 bg-amber-700/10 text-amber-500';
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
          Commendations & Insignias
        </label>
        {userStaffRank > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[#00FF88] font-mono">
            <Shield className="w-3 h-3" /> Command Staff Clearances
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {badges.map((badge) => {
          const isLockedStaff = badge.isStaffLocked && userStaffRank === 0;
          const isSelected = badge.id === selectedBadgeId;

          return (
            <div
              key={badge.id}
              onClick={() => {
                if (!isLockedStaff && onSelectBadge) {
                  onSelectBadge(badge);
                }
              }}
              className={`relative flex items-start gap-3 p-3 rounded-xl border transition-all duration-200 select-none ${
                isLockedStaff
                  ? 'bg-[#0B0E14]/60 border-[#232936] opacity-50 cursor-not-allowed'
                  : 'bg-[#151922] border-[#232936] hover:border-[#64748B]/50 cursor-pointer'
              } ${isSelected ? 'ring-2 ring-[#00F0FF] border-[#00F0FF]' : ''}`}
            >
              <div
                className={`flex items-center justify-center w-9 h-9 rounded-lg border ${getTierColor(
                  badge.tier
                )} shrink-0`}
              >
                {isLockedStaff ? (
                  <Lock className="w-4 h-4 text-[#64748B]" />
                ) : (
                  <Award className="w-4 h-4" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs font-semibold text-[#F0F4F8] truncate">{badge.name}</h4>
                  {badge.isStaffLocked && (
                    <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[#FF3366]/20 text-[#FF3366] uppercase">
                      Staff
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#94A3B8] line-clamp-2 mt-0.5 leading-snug">
                  {badge.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
