import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@subspace/ui';

export interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  serverId: string;
  onUpdateServerName?: (newName: string) => void;
  onDeleteServer?: () => void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  isOpen,
  onClose,
  serverName,
  serverId,
  onUpdateServerName,
  onDeleteServer,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'channels' | 'emojis' | 'audit'>('overview');
  const [nameInput, setNameInput] = useState(serverName);

  useEffect(() => {
    setNameInput(serverName);
  }, [serverName, isOpen]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Server Settings — ${serverName}`}
      maxWidth="2xl"
    >
      <div className="flex gap-6 max-h-[75vh] select-none text-[#dbdee1]">
        {/* Left Navigation */}
        <div className="w-48 flex flex-col gap-1 border-r border-[#1f2024] pr-4 shrink-0 text-xs font-medium">
          <div className="text-[10px] uppercase font-bold text-[#949ba4] px-2 py-1">
            {serverName.slice(0, 16)}
          </div>
          <button
            onClick={() => setActiveTab('overview')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'overview' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'roles' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Clearances & Roles
          </button>
          <button
            onClick={() => setActiveTab('channels')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'channels' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Channel Management
          </button>
          <button
            onClick={() => setActiveTab('emojis')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'emojis' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Custom Emoji & Stickers
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'audit' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Audit Log
          </button>

          <div className="pt-4 mt-2 border-t border-[#1f2024]">
            <button
              onClick={onDeleteServer}
              className="w-full text-left px-2.5 py-1.5 rounded-[4px] text-xs font-semibold text-[#f23f43] hover:bg-[#f23f43]/10 transition-colors flex items-center justify-between"
            >
              <span>Delete Server</span>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-6 text-xs">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Server Overview</h3>
                <p className="text-xs text-[#949ba4]">Customize the tactical identification parameters for this subspace beacon.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] uppercase font-bold text-[#b5bac1]">SERVER NAME</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/50 rounded-[6px] px-3 py-2 text-sm text-white outline-none"
                />
              </div>

              <div className="p-3 rounded-[8px] bg-[#111214] border border-[#1f2024] space-y-2">
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Server Node ID</span>
                  <span className="font-mono text-white select-all">{serverId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Quantum Protocol</span>
                  <span className="text-[#00f0ff] font-mono">SF-QKD-V2.4</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#949ba4]">Subspace Relay Region</span>
                  <span className="text-[#23a55a] font-medium">Orbital Station US-East</span>
                </div>
              </div>

              {nameInput !== serverName && (
                <div className="p-3 bg-[#111214] border border-[#00f0ff]/30 rounded-[8px] flex items-center justify-between">
                  <span className="text-xs text-white">Careful — you have unsaved changes!</span>
                  <button
                    onClick={() => {
                      if (onUpdateServerName) onUpdateServerName(nameInput);
                    }}
                    className="bg-[#23a55a] hover:bg-[#1f934f] text-white px-3 py-1.5 rounded-[4px] font-semibold"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'roles' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Clearances & Roles</h3>
                <p className="text-xs text-[#949ba4]">Use roles to group server transmitters and assign clearance permissions.</p>
              </div>

              <div className="space-y-2">
                {[
                  { name: 'Fleet Admiral', color: '#00f0ff', count: 1, permissions: 'Administrator, Manage Channels, Ban' },
                  { name: 'Command Staff', color: '#5865f2', count: 2, permissions: 'Manage Messages, Mute Members' },
                  { name: 'Transmitter', color: '#23a55a', count: 8, permissions: 'Send Messages, Connect Voice' },
                  { name: '@everyone', color: '#949ba4', count: 11, permissions: 'View Channels, Read History' },
                ].map((role) => (
                  <div key={role.name} className="p-3 rounded-[6px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                      <div>
                        <div className="font-semibold text-white">{role.name}</div>
                        <div className="text-[10px] text-[#949ba4]">{role.permissions}</div>
                      </div>
                    </div>
                    <span className="text-[11px] text-[#949ba4]">{role.count} members</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'channels' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Channel Organization</h3>
                <p className="text-xs text-[#949ba4]">Manage category hierarchies and default notification relays.</p>
              </div>

              <div className="p-4 rounded-[8px] bg-[#111214] border border-[#1f2024] text-center text-[#949ba4]">
                All channel layouts are synchronized with real database relays.
              </div>
            </div>
          )}

          {activeTab === 'emojis' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Custom Beacon Emojis</h3>
                <p className="text-xs text-[#949ba4]">Add up to 50 custom emojis that members can use across subspace.</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['⚡', '🛸', '🛰️', '🚀', '🔬', '🌌', '📡', '☄️'].map((emoji, idx) => (
                  <div key={idx} className="p-3 rounded bg-[#111214] border border-[#1f2024] flex flex-col items-center justify-center text-xl">
                    <span>{emoji}</span>
                    <span className="text-[10px] text-[#80848e] font-mono mt-1">:slot_{idx + 1}:</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Audit Log</h3>
                <p className="text-xs text-[#949ba4]">Chronological ledger of tactical administrative events.</p>
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="p-2.5 rounded bg-[#111214] border border-[#1f2024] flex justify-between">
                  <span className="text-white">cmdr_you updated channel topic for #quantum-resonance</span>
                  <span className="text-[#80848e]">10m ago</span>
                </div>
                <div className="p-2.5 rounded bg-[#111214] border border-[#1f2024] flex justify-between">
                  <span className="text-white">adm_vance pinned transmission in #announcements</span>
                  <span className="text-[#80848e]">2h ago</span>
                </div>
                <div className="p-2.5 rounded bg-[#111214] border border-[#1f2024] flex justify-between">
                  <span className="text-white">Automated Bot created relay category Text Relays</span>
                  <span className="text-[#80848e]">Yesterday</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
