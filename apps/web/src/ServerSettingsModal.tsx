import React, { useState, useEffect } from 'react';
import { Trash2, Upload, Plus, Edit2, Check, X } from 'lucide-react';
import { Modal } from '@subspace/ui';

export interface CustomServerEmoji {
  id: string;
  name: string;
  url: string;
}

export interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  serverId: string;
  onUpdateServerName?: (newName: string) => void;
  onDeleteServer?: () => void;
  emojis?: CustomServerEmoji[];
  onUploadEmoji?: (name: string, url: string) => void;
  onRenameEmoji?: (emojiId: string, newName: string) => void;
  onDeleteEmoji?: (emojiId: string) => void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  isOpen,
  onClose,
  serverName,
  serverId,
  onUpdateServerName,
  onDeleteServer,
  emojis = [],
  onUploadEmoji,
  onRenameEmoji,
  onDeleteEmoji,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'channels' | 'emojis' | 'audit'>('overview');
  const [nameInput, setNameInput] = useState(serverName);

  // Emoji management state
  const [newEmojiName, setNewEmojiName] = useState('');
  const [newEmojiUrl, setNewEmojiUrl] = useState('');
  const [editingEmojiId, setEditingEmojiId] = useState<string | null>(null);
  const [editEmojiName, setEditEmojiName] = useState('');

  useEffect(() => {
    setNameInput(serverName);
  }, [serverName, isOpen]);

  if (!isOpen) return null;

  const handleCreateEmoji = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmojiName.trim() || !newEmojiUrl.trim()) return;
    if (onUploadEmoji) {
      onUploadEmoji(newEmojiName.trim(), newEmojiUrl.trim());
    }
    setNewEmojiName('');
    setNewEmojiUrl('');
  };

  const handleSaveRename = (emojiId: string) => {
    if (!editEmojiName.trim()) return;
    if (onRenameEmoji) {
      onRenameEmoji(emojiId, editEmojiName.trim());
    }
    setEditingEmojiId(null);
    setEditEmojiName('');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Server Settings — ${serverName}`}
      fixedDimensions={true}
    >
      <div className="flex flex-1 h-full gap-6 select-none text-[#dbdee1] min-h-0">
        {/* Left Navigation */}
        <div className="w-48 flex flex-col gap-1 border-r border-[#1f2024] pr-4 shrink-0 text-xs font-medium">
          <div className="text-[10px] uppercase font-bold text-[#949ba4] px-2 py-1 truncate">
            {serverName}
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
            Relay Channels
          </button>
          <button
            onClick={() => setActiveTab('emojis')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'emojis' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Signal Glyphs (Emojis)
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'audit' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Audit Telemetry
          </button>

          <div className="h-[1px] bg-[#1f2024] my-2" />

          {onDeleteServer && (
            <button
              onClick={onDeleteServer}
              className="text-left px-2.5 py-1.5 rounded-[4px] text-[#f23f43] hover:bg-[#f23f43]/10 transition-colors flex items-center justify-between"
            >
              <span>Decommission Beacon</span>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right Content Pane - Scrollable */}
        <div className="flex-1 overflow-y-auto pr-2 text-xs">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Server Overview</h3>
                <p className="text-xs text-[#949ba4]">Configure basic parameters for your subspace beacon node.</p>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider block mb-1">
                  SERVER NAME
                </label>
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

          {/* Fully Functional Signal Glyphs / Custom Emojis Tab */}
          {activeTab === 'emojis' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Custom Beacon Signal Glyphs</h3>
                <p className="text-xs text-[#949ba4]">
                  Upload custom emojis that transmitters can use in transmissions and reactions.
                </p>
              </div>

              {/* Upload Form */}
              <form onSubmit={handleCreateEmoji} className="p-3 rounded-[8px] bg-[#111214] border border-[#1f2024] space-y-3">
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-[#00f0ff]" />
                  <span>Upload New Glyph</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Glyph name (e.g. hyperdrive)"
                    value={newEmojiName}
                    onChange={(e) => setNewEmojiName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className="bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white placeholder-[#80848e] outline-none"
                  />
                  <input
                    type="url"
                    required
                    placeholder="Image URL (PNG, WEBP, SVG)"
                    value={newEmojiUrl}
                    onChange={(e) => setNewEmojiUrl(e.target.value)}
                    className="bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white placeholder-[#80848e] outline-none"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="bg-[#5865f2] hover:bg-[#4752c4] text-white px-3 py-1.5 rounded-[4px] font-semibold text-xs transition-colors flex items-center gap-1"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload Glyph
                  </button>
                </div>
              </form>

              {/* Existing Emojis List */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider">
                  ACTIVE GLYPHS ({emojis.length}/50)
                </div>
                {emojis.length === 0 ? (
                  <div className="p-4 rounded-[6px] bg-[#111214] border border-[#1f2024] text-center text-[#80848e]">
                    No custom emojis uploaded yet. Add your first beacon signal glyph above!
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {emojis.map((emoji) => (
                      <div
                        key={emoji.id}
                        className="p-2.5 rounded-[6px] bg-[#111214] border border-[#1f2024] flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={emoji.url}
                            alt={emoji.name}
                            className="w-7 h-7 object-contain rounded shrink-0 bg-[#1e1f22] p-0.5"
                          />
                          {editingEmojiId === emoji.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editEmojiName}
                                onChange={(e) => setEditEmojiName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                className="bg-[#1e1f22] border border-[#00f0ff] rounded px-1.5 py-0.5 text-xs text-white outline-none w-24"
                              />
                              <button
                                onClick={() => handleSaveRename(emoji.id)}
                                className="p-1 hover:text-[#23a55a]"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingEmojiId(null)}
                                className="p-1 hover:text-[#f23f43]"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="font-mono text-xs text-white truncate">:{emoji.name}:</span>
                          )}
                        </div>

                        {editingEmojiId !== emoji.id && (
                          <div className="flex items-center gap-1 text-[#949ba4]">
                            <button
                              onClick={() => {
                                setEditingEmojiId(emoji.id);
                                setEditEmojiName(emoji.name);
                              }}
                              className="p-1 hover:text-white"
                              title="Rename emoji"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {onDeleteEmoji && (
                              <button
                                onClick={() => onDeleteEmoji(emoji.id)}
                                className="p-1 hover:text-[#f23f43]"
                                title="Delete emoji"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Audit Telemetry</h3>
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
