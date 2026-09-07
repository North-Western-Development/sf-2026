import React, { useState, useEffect } from 'react';
import { Trash2, Upload, Plus, Edit2, Check, X, Users, Eye } from 'lucide-react';
import { Modal } from '@subspace/ui';
import { api } from './services/api';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'channels' | 'emojis' | 'onboarding' | 'discovery' | 'audit'>('overview');
  const [nameInput, setNameInput] = useState(serverName);

  // Emoji management state
  const [newEmojiName, setNewEmojiName] = useState('');
  const [newEmojiUrl, setNewEmojiUrl] = useState('');
  const [editingEmojiId, setEditingEmojiId] = useState<string | null>(null);
  const [editEmojiName, setEditEmojiName] = useState('');

  // Clearances / Roles state
  const [clearancesList, setClearancesList] = useState<any[]>([
    { id: 'c1', name: 'Fleet Admiral', color: '#00f0ff', position: 3, permissions: (1n << 29n).toString(), count: 1, hoist: true },
    { id: 'c2', name: 'Command Staff', color: '#5865f2', position: 2, permissions: ((1n << 0n) | (1n << 1n) | (1n << 8n)).toString(), count: 2, hoist: false },
    { id: 'c3', name: 'Transmitter', color: '#23a55a', position: 1, permissions: ((1n << 0n) | (1n << 1n) | (1n << 5n)).toString(), count: 8, hoist: false },
    { id: 'c4', name: '@everyone', color: '#949ba4', position: 0, permissions: (1n << 0n).toString(), count: 11, hoist: false },
  ]);
  const [selectedClearanceId, setSelectedClearanceId] = useState<string>('c2');
  const [newClearanceName, setNewClearanceName] = useState('');
  const [newClearanceColor, setNewClearanceColor] = useState('#00f0ff');

  // Role rename state
  const [renamingRoleId, setRenamingRoleId] = useState<string | null>(null);
  const [renameRoleInput, setRenameRoleInput] = useState('');

  // Onboarding state
  const [rulesText, setRulesText] = useState('Welcome to this Beacon. Please read and agree to the rules before participating.');
  const [requiresOnboarding, setRequiresOnboarding] = useState(true);
  const [onboardingSaved, setOnboardingSaved] = useState(false);

  // Discovery state
  const [isDiscoverable, setIsDiscoverable] = useState(false);
  const [discoverySaved, setDiscoverySaved] = useState(false);

  const selectedClearance = clearancesList.find(c => c.id === selectedClearanceId) || clearancesList[0];

  const PERMISSION_ITEMS = [
    { bit: 1n << 0n, label: 'View Relay Channels', desc: 'Allows members to view channels in this beacon.' },
    { bit: 1n << 1n, label: 'Send Transmissions', desc: 'Allows members to post messages in text and archival relays.' },
    { bit: 1n << 2n, label: 'Embed Rich Links', desc: 'Unfurls web previews for transmitted hyperlinks.' },
    { bit: 1n << 3n, label: 'Attach Vault Files', desc: 'Allows uploading and attaching files from Subspace Vault.' },
    { bit: 1n << 4n, label: 'Use Signal Glyphs', desc: 'Allows using custom beacon emojis and reactions.' },
    { bit: 1n << 5n, label: 'Connect Comm-Link Audio', desc: 'Allows joining voice frequencies and rooms.' },
    { bit: 1n << 6n, label: 'Transmit Voice Audio', desc: 'Allows speaking in Comm-Link audio channels.' },
    { bit: 1n << 7n, label: 'Broadcast Holo-Cast', desc: 'Allows screensharing and video broadcasting.' },
    { bit: 1n << 8n, label: 'Manage Transmissions', desc: 'Allows deleting and pinning messages from others.' },
    { bit: 1n << 9n, label: 'Manage Relay Channels', desc: 'Allows creating, editing, and deleting beacon relays.' },
    { bit: 1n << 10n, label: 'Manage Clearances', desc: 'Allows creating and editing roles lower than own rank.' },
    { bit: 1n << 29n, label: 'Administrator', desc: 'Grants all clearances and bypasses channel overrides.' },
  ];

  const handleTogglePermission = (permBit: bigint) => {
    if (!selectedClearance) return;
    const currentBits = BigInt(selectedClearance.permissions || 0);
    const hasBit = (currentBits & permBit) === permBit;
    const newBits = hasBit ? currentBits & ~permBit : currentBits | permBit;

    setClearancesList(prev => prev.map(c => 
      c.id === selectedClearance.id ? { ...c, permissions: newBits.toString() } : c
    ));
  };

  const handleAddClearance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClearanceName.trim()) return;
    const newRole = {
      id: `c-${Date.now()}`,
      name: newClearanceName.trim(),
      color: newClearanceColor,
      position: clearancesList.length,
      permissions: ((1n << 0n) | (1n << 1n)).toString(),
      count: 0,
      hoist: false,
    };
    setClearancesList(prev => [newRole, ...prev]);
    setSelectedClearanceId(newRole.id);
    setNewClearanceName('');
  };

  const handleStartRenameRole = (roleId: string, currentName: string) => {
    setRenamingRoleId(roleId);
    setRenameRoleInput(currentName);
  };

  const handleSaveRenameRole = async (roleId: string) => {
    const trimmed = renameRoleInput.trim();
    if (!trimmed) return;
    setClearancesList(prev => prev.map(c =>
      c.id === roleId ? { ...c, name: trimmed } : c
    ));
    setRenamingRoleId(null);
    setRenameRoleInput('');
    try {
      await api.updateClearance(serverId, roleId, { name: trimmed });
    } catch { /* optimistic — local state already updated */ }
  };

  const handleToggleHoist = async (roleId: string) => {
    const role = clearancesList.find(c => c.id === roleId);
    if (!role) return;
    const newHoist = !role.hoist;
    setClearancesList(prev => prev.map(c =>
      c.id === roleId ? { ...c, hoist: newHoist } : c
    ));
    try {
      await api.updateClearance(serverId, roleId, { hoist: newHoist });
    } catch { /* optimistic */ }
  };

  const handleSaveOnboarding = async () => {
    try {
      await api.updateBeacon(serverId, { rulesText });
      setOnboardingSaved(true);
      setTimeout(() => setOnboardingSaved(false), 2000);
    } catch { /* noop */ }
  };

  const handleSaveDiscovery = async () => {
    try {
      await api.updateBeacon(serverId, { isDiscoverable });
      setDiscoverySaved(true);
      setTimeout(() => setDiscoverySaved(false), 2000);
    } catch { /* noop */ }
  };

  useEffect(() => {
    setNameInput(serverName);
  }, [serverName, isOpen]);

  const handleCreateEmoji = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmojiName.trim() || !newEmojiUrl.trim()) return;
    if (onUploadEmoji) {
      onUploadEmoji(newEmojiName.trim(), newEmojiUrl.trim());
    }
    setNewEmojiName('');
    setNewEmojiUrl('');
  };

  const handleSaveEmojiRename = (emojiId: string) => {
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
            onClick={() => setActiveTab('onboarding')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'onboarding' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Onboarding
          </button>
          <button
            onClick={() => setActiveTab('discovery')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors ${
              activeTab === 'discovery' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            Discovery
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
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-0.5">Clearances & Roles (64-Bit Bitfield Architecture)</h3>
                  <p className="text-xs text-[#949ba4]">Configure hierarchy positions, display colors, and granular permission bitfields.</p>
                </div>
              </div>

              {/* Add Role Header Form */}
              <form onSubmit={handleAddClearance} className="flex items-center gap-2 p-2 bg-[#111214] border border-[#1f2024] rounded-[6px]">
                <input
                  type="text"
                  value={newClearanceName}
                  onChange={e => setNewClearanceName(e.target.value)}
                  placeholder="New Clearance Name (e.g. Flight Officer)"
                  className="flex-1 bg-[#080809] border border-[#2b2d31] rounded px-2.5 py-1 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
                />
                <input
                  type="color"
                  value={newClearanceColor}
                  onChange={e => setNewClearanceColor(e.target.value)}
                  className="w-7 h-7 bg-transparent border-0 cursor-pointer rounded"
                  title="Clearance Color"
                />
                <button
                  type="submit"
                  disabled={!newClearanceName.trim()}
                  className="bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-black font-semibold px-3 py-1 rounded text-xs transition-colors disabled:opacity-40"
                >
                  Create Clearance
                </button>
              </form>

              {/* Two Column Layout: Clearance Selector & Permission Bit Switches */}
              <div className="flex gap-4 pt-1">
                {/* Left Roles List */}
                <div className="w-52 space-y-1.5 shrink-0">
                  <div className="text-[10px] font-bold text-[#80848e] uppercase px-1">Clearance Hierarchy</div>
                  {clearancesList.map((role) => {
                    const isSelected = selectedClearanceId === role.id;
                    return (
                      <div
                        key={role.id}
                        className={`p-2.5 rounded-[6px] border transition-colors ${
                          isSelected
                            ? 'border-[#00f0ff] bg-[#00f0ff]/10'
                            : 'border-[#1f2024] bg-[#111214] hover:border-[#35363c]'
                        }`}
                      >
                        {/* Name row */}
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => setSelectedClearanceId(role.id)}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                            {renamingRoleId === role.id ? (
                              <input
                                type="text"
                                value={renameRoleInput}
                                onChange={e => setRenameRoleInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); handleSaveRenameRole(role.id); }
                                  if (e.key === 'Escape') { setRenamingRoleId(null); }
                                }}
                                onClick={e => e.stopPropagation()}
                                autoFocus
                                className="flex-1 bg-[#080809] border border-[#00f0ff] rounded px-1.5 py-0.5 text-xs text-white outline-none min-w-0"
                              />
                            ) : (
                              <span className="truncate text-xs text-white">{role.name}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 ml-1 shrink-0">
                            {renamingRoleId === role.id ? (
                              <>
                                <button
                                  onClick={e => { e.stopPropagation(); handleSaveRenameRole(role.id); }}
                                  className="p-0.5 text-[#23a55a] hover:text-[#23a55a]/80 transition-colors"
                                  title="Save name"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); setRenamingRoleId(null); }}
                                  className="p-0.5 text-[#f23f43] hover:text-[#f23f43]/80 transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </>
                            ) : (
                              <>
                                {role.position !== 0 && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleStartRenameRole(role.id, role.name); }}
                                    className="p-0.5 text-[#80848e] hover:text-white transition-colors"
                                    title="Rename role"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                )}
                                <span className="text-[10px] text-[#80848e] font-mono">P{role.position}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Hoist (Display Separately) toggle */}
                        <div
                          className="flex items-center justify-between mt-2 pt-2 border-t border-[#1f2024]"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3 h-3 text-[#80848e]" />
                            <span className="text-[10px] text-[#80848e]">Display separately</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={role.hoist || false}
                              disabled={role.position === 0}
                              onChange={() => handleToggleHoist(role.id)}
                              className="sr-only peer"
                            />
                            <div className="w-7 h-3.5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-[#23a55a] peer-disabled:opacity-40" />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Permission Bit Switches */}
                <div className="flex-1 bg-[#111214] border border-[#1f2024] rounded-[8px] p-3.5 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#1f2024] pb-2">
                    <div>
                      <div className="font-bold text-white text-xs flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedClearance?.color }} />
                        <span>{selectedClearance?.name} Permissions</span>
                      </div>
                      <span className="text-[10px] font-mono text-[#00f0ff]">
                        Bitfield: 0x{BigInt(selectedClearance?.permissions || 0).toString(16).toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {PERMISSION_ITEMS.map(item => {
                      const currentBits = BigInt(selectedClearance?.permissions || 0);
                      const isChecked = (currentBits & item.bit) === item.bit || (currentBits & (1n << 29n)) === (1n << 29n);
                      const isAdm = (currentBits & (1n << 29n)) === (1n << 29n) && item.bit !== (1n << 29n);

                      return (
                        <div
                          key={item.label}
                          className="flex items-center justify-between p-2 rounded bg-[#0b0c0e] border border-[#1f2024]"
                        >
                          <div className="pr-3">
                            <div className="font-semibold text-white text-xs">{item.label}</div>
                            <div className="text-[10px] text-[#80848e]">{item.desc}</div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={isAdm}
                              onChange={() => handleTogglePermission(item.bit)}
                              className="sr-only peer"
                            />
                            <div className="w-8 h-4 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#23a55a]"></div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                                onClick={() => handleSaveEmojiRename(emoji.id)}
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

          {/* ─── Onboarding Tab ──────────────────────────────── */}
          {activeTab === 'onboarding' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Member Onboarding</h3>
                <p className="text-xs text-[#949ba4]">
                  Control the new member experience. When enabled, members must acknowledge your rules before accessing the beacon.
                </p>
              </div>

              {/* Enable / Disable Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-[#111214] border border-[#1f2024] rounded-[8px]">
                <div>
                  <div className="text-xs font-semibold text-white">Require Onboarding</div>
                  <div className="text-[10px] text-[#949ba4] mt-0.5">New members must read and accept your rules before joining.</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={requiresOnboarding}
                    onChange={() => setRequiresOnboarding(v => !v)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                </label>
              </div>

              {/* Rules Text */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#949ba4] uppercase tracking-wider">
                  Rules &amp; Welcome Text
                </label>
                <textarea
                  value={rulesText}
                  onChange={e => setRulesText(e.target.value)}
                  rows={8}
                  className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2.5 text-sm text-[#dbdee1] placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none transition-colors leading-relaxed"
                  placeholder="Enter your server rules and welcome message here…"
                />
                <div className="text-[10px] text-[#80848e]">
                  Supports markdown. Members will see this text before being granted access.
                </div>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveOnboarding}
                  className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold text-xs rounded-[6px] transition-colors"
                >
                  Save Onboarding Settings
                </button>
                {onboardingSaved && (
                  <span className="text-xs text-[#23a55a] flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ─── Discovery Tab ────────────────────────────────── */}
          {activeTab === 'discovery' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Beacon Discovery</h3>
                <p className="text-xs text-[#949ba4]">
                  Control whether your beacon appears in the public Subspace discovery listing.
                </p>
              </div>

              {/* Discoverable Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-[#111214] border border-[#1f2024] rounded-[8px]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[8px] bg-[#1f2024] flex items-center justify-center shrink-0">
                    <Eye className="w-4 h-4 text-[#00f0ff]" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">List in Public Discovery</div>
                    <div className="text-[10px] text-[#949ba4] mt-0.5">
                      When enabled, anyone can find and join this beacon via the Explore Beacons feature.
                    </div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                  <input
                    type="checkbox"
                    checked={isDiscoverable}
                    onChange={() => setIsDiscoverable(v => !v)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                </label>
              </div>

              {/* Status Pill */}
              <div className={`flex items-center gap-2 p-3 rounded-[6px] border text-xs font-medium ${
                isDiscoverable
                  ? 'bg-[#23a55a]/10 border-[#23a55a]/30 text-[#23a55a]'
                  : 'bg-[#111214] border-[#1f2024] text-[#80848e]'
              }`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${isDiscoverable ? 'bg-[#23a55a]' : 'bg-[#80848e]'}`} />
                {isDiscoverable
                  ? 'This beacon is publicly listed and discoverable.'
                  : 'This beacon is private and not listed in discovery.'}
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveDiscovery}
                  className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold text-xs rounded-[6px] transition-colors"
                >
                  Save Discovery Settings
                </button>
                {discoverySaved && (
                  <span className="text-xs text-[#23a55a] flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
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
