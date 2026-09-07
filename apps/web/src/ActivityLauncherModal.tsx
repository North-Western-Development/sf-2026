import React, { useState } from 'react';
import { Modal } from '@subspace/ui';
import { Sparkles, Tv, Trophy, Music, Palette, Play, Check } from 'lucide-react';

export interface ActivityItem {
  id: string;
  name: string;
  category: string;
  description: string;
  iconName: string;
  tag?: string;
  color: string;
}

export const ACTIVITIES: ActivityItem[] = [
  {
    id: 'watch-together',
    name: 'Watch Together',
    category: 'Media & Sync',
    description: 'Stream and watch synchronized YouTube and Subspace transmissions together in real-time.',
    iconName: 'tv',
    tag: 'POPULAR',
    color: '#eb459e',
  },
  {
    id: 'quantum-chess',
    name: 'Quantum Chess',
    category: 'Tactical Board Game',
    description: 'Engage in synchronized tactical quantum chess on an interactive holographic board.',
    iconName: 'trophy',
    tag: 'TACTICAL',
    color: '#00f0ff',
  },
  {
    id: 'sketch-protocol',
    name: 'Sketch Protocol',
    category: 'Multiplayer Party',
    description: 'Collaborative visual drawing and rapid tactical transmission deciphering game.',
    iconName: 'palette',
    tag: 'CASUAL',
    color: '#5865f2',
  },
  {
    id: 'jam-frequency',
    name: 'Jam Frequency',
    category: 'Audio Lounge',
    description: 'Shared high-fidelity lofi audio stream and collaborative music queue session.',
    iconName: 'music',
    tag: 'AUDIO',
    color: '#23a55a',
  },
];

interface ActivityLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchActivity: (activity: ActivityItem) => void;
  activeActivityId?: string | null;
}

export const ActivityLauncherModal: React.FC<ActivityLauncherModalProps> = ({
  isOpen,
  onClose,
  onLaunchActivity,
  activeActivityId,
}) => {
  const [selectedId, setSelectedId] = useState<string>(ACTIVITIES[0].id);

  const selectedActivity = ACTIVITIES.find(a => a.id === selectedId) || ACTIVITIES[0];

  const renderIcon = (iconName: string, className: string) => {
    switch (iconName) {
      case 'tv': return <Tv className={className} />;
      case 'trophy': return <Trophy className={className} />;
      case 'palette': return <Palette className={className} />;
      case 'music': return <Music className={className} />;
      default: return <Sparkles className={className} />;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Activity Launcher"
      description="Launch interactive collaborative activities directly into your voice frequency stage."
      maxWidth="lg"
    >
      <div className="space-y-4 select-none text-[#dbdee1]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ACTIVITIES.map((act) => {
            const isSelected = selectedId === act.id;
            const isRunning = activeActivityId === act.id;

            return (
              <div
                key={act.id}
                onClick={() => setSelectedId(act.id)}
                className={`p-3.5 rounded-[10px] border cursor-pointer transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-[#1a1b1e] border-[#00f0ff] shadow-[0_0_16px_rgba(0,240,255,0.15)]'
                    : 'bg-[#111214] border-[#1f2024] hover:bg-[#16171a]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0 shadow-inner"
                    style={{ backgroundColor: `${act.color}20`, color: act.color }}
                  >
                    {renderIcon(act.iconName, "w-5 h-5")}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {act.tag && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: `${act.color}20`, color: act.color }}
                      >
                        {act.tag}
                      </span>
                    )}
                    {isRunning && (
                      <span className="text-[9px] font-bold bg-[#23a55a]/20 text-[#23a55a] px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                        <Check className="w-2.5 h-2.5" /> RUNNING
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-sm font-bold text-white flex items-center justify-between">
                    <span>{act.name}</span>
                  </div>
                  <div className="text-[11px] text-[#80848e] font-medium">{act.category}</div>
                  <p className="text-xs text-[#949ba4] mt-1.5 line-clamp-2 leading-relaxed">
                    {act.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Activity Preview Bar & Launch Action */}
        <div className="mt-4 p-3.5 rounded-[8px] bg-[#0b0c0e] border border-[#1f2024] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-[6px] flex items-center justify-center text-sm shrink-0"
              style={{ backgroundColor: `${selectedActivity.color}25`, color: selectedActivity.color }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">{selectedActivity.name}</div>
              <div className="text-[11px] text-[#80848e]">Ready to deploy to voice stage</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onLaunchActivity(selectedActivity);
              onClose();
            }}
            className="px-5 py-2 rounded-[6px] text-xs font-bold text-white bg-[#5865f2] hover:bg-[#4752c4] flex items-center gap-2 transition-all shadow-[0_0_12px_rgba(88,101,242,0.4)]"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Launch Activity</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
