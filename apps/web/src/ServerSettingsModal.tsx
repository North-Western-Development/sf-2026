import React, { useState, useEffect } from 'react';
import { 
  Trash2, 
  Upload, 
  Plus, 
  Edit2, 
  Check, 
  X, 
  Users, 
  Eye, 
  EyeOff, 
  Bell, 
  Shield, 
  Activity, 
  HelpCircle, 
  Image as ImageIcon, 
  Hash, 
  Volume2, 
  Radio, 
  Archive, 
  Search, 
  FolderPlus, 
  AlertCircle
} from 'lucide-react';
import { Modal } from '@subspace/ui';
import { api } from './services/api';

export interface CustomServerEmoji {
  id: string;
  name: string;
  url: string;
}

export interface ServerChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'archive' | 'gallery';
  description?: string;
  unread?: boolean;
  isHidden?: boolean;
  isMuted?: boolean;
  isUnhideable?: boolean;
}

export interface ServerCategory {
  id: string;
  name: string;
  collapsed?: boolean;
  channels: ServerChannel[];
}

export interface OnboardingOption {
  id: string;
  label: string;
  description?: string;
  roleId?: string;
  roleName?: string;
  roleColor?: string;
}

export interface OnboardingQuestion {
  id: string;
  title: string;
  description?: string;
  timing: 'join_and_browse' | 'browse_only';
  options: OnboardingOption[];
}

export interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  serverId: string;
  initialTab?: 'overview' | 'roles' | 'channels' | 'emojis' | 'onboarding' | 'discovery' | 'notifications' | 'privacy' | 'insights' | 'audit';
  onUpdateServerName?: (newName: string) => void;
  onDeleteServer?: () => void;
  emojis?: CustomServerEmoji[];
  onUploadEmoji?: (name: string, url: string) => void;
  onRenameEmoji?: (emojiId: string, newName: string) => void;
  onDeleteEmoji?: (emojiId: string) => void;
  categories?: ServerCategory[];
  onUpdateRelay?: (relayId: string, updates: { name?: string; topic?: string }) => Promise<void> | void;
  onDeleteRelay?: (relayId: string) => Promise<void> | void;
  onCreateRelay?: (name: string, type: string, topic?: string, categoryId?: string) => Promise<void> | void;
  onCreateCategory?: (name: string) => Promise<void> | void;
  onToggleRelayVisibility?: (relayId: string, isHidden: boolean) => Promise<void> | void;
  onboardingQuestions?: OnboardingQuestion[];
  onUpdateOnboardingQuestions?: (questions: OnboardingQuestion[]) => void;
}

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  isOpen,
  onClose,
  serverName,
  serverId,
  initialTab = 'overview',
  onUpdateServerName,
  onDeleteServer,
  emojis = [],
  onUploadEmoji,
  onRenameEmoji,
  onDeleteEmoji,
  categories = [],
  onUpdateRelay,
  onDeleteRelay,
  onCreateRelay,
  onCreateCategory,
  onToggleRelayVisibility,
  onboardingQuestions: propOnboardingQuestions,
  onUpdateOnboardingQuestions,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'channels' | 'emojis' | 'onboarding' | 'discovery' | 'notifications' | 'privacy' | 'insights' | 'audit'>(initialTab);
  const [nameInput, setNameInput] = useState(serverName);

  // Notification settings state
  const [notifyLevel, setNotifyLevel] = useState<'all' | 'mentions' | 'nothing'>('mentions');
  const [suppressEveryone, setSuppressEveryone] = useState(false);
  const [suppressRoles, setSuppressRoles] = useState(false);
  const [muteServer, setMuteServer] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);

  // Privacy & Safety settings state
  const [allowDms, setAllowDms] = useState(true);
  const [filterExplicit, setFilterExplicit] = useState<'scan_all' | 'scan_non_friends' | 'disabled'>('scan_all');
  const [restrictedActivity, setRestrictedActivity] = useState(false);
  const [privacySaved, setPrivacySaved] = useState(false);

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
  const [defaultChannels, setDefaultChannels] = useState<string[]>(['general', 'announcements', 'welcome']);
  const [onboardingQuestions, setOnboardingQuestions] = useState<OnboardingQuestion[]>(() => {
    if (propOnboardingQuestions && propOnboardingQuestions.length > 0) {
      return propOnboardingQuestions;
    }
    return [
      {
        id: 'q1',
        title: 'What is your primary operational role?',
        description: 'Select your operational flight specialty to receive your designated fleet role.',
        timing: 'join_and_browse',
        options: [
          { id: 'opt-tactical', label: 'Tactical Pilot', roleId: 'c3' },
          { id: 'opt-scout', label: 'Cartographer & Scout', roleId: 'c3' },
          { id: 'opt-comms', label: 'Communications Specialist', roleId: 'c2' },
        ],
      },
      {
        id: 'q2',
        title: 'What notifications and mission alerts would you like to receive?',
        description: 'Choose extra alert pings and interest groups across this beacon.',
        timing: 'browse_only',
        options: [
          { id: 'opt-alerts', label: 'Orbital Recon Alerts', roleId: 'c2' },
          { id: 'opt-casual', label: 'Community Signals & Holo-Events', roleId: 'c3' },
        ],
      },
    ];
  });

  useEffect(() => {
    if (propOnboardingQuestions && propOnboardingQuestions.length > 0) {
      setOnboardingQuestions(propOnboardingQuestions);
    }
  }, [propOnboardingQuestions]);

  // Discovery state
  const [isDiscoverable, setIsDiscoverable] = useState(false);
  const [discoveryDescription, setDiscoveryDescription] = useState('A public Subspace outpost dedicated to frequency relays, galactic exploration, and orbital strategy.');
  const [discoveryBannerUrl, setDiscoveryBannerUrl] = useState('');
  const [discoveryCategory, setDiscoveryCategory] = useState('Gaming');
  const [discoverySaved, setDiscoverySaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  // Channel Manager State
  const [channelSearch, setChannelSearch] = useState('');
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelTopic, setEditChannelTopic] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [createTargetCategoryId, setCreateTargetCategoryId] = useState<string | undefined>(undefined);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice' | 'announcement' | 'archive' | 'gallery'>('text');
  const [newChannelTopic, setNewChannelTopic] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [channelToDelete, setChannelToDelete] = useState<ServerChannel | null>(null);
  const [channelActionLoading, setChannelActionLoading] = useState(false);

  const handleStartEditChannel = (channel: ServerChannel) => {
    setEditingChannelId(channel.id);
    setEditChannelName(channel.name);
    setEditChannelTopic(channel.description || '');
  };

  const handleSaveEditChannel = async (channelId: string) => {
    if (!editChannelName.trim()) return;
    setChannelActionLoading(true);
    try {
      if (onUpdateRelay) {
        await onUpdateRelay(channelId, {
          name: editChannelName.trim(),
          topic: editChannelTopic.trim(),
        });
      }
      setEditingChannelId(null);
    } finally {
      setChannelActionLoading(false);
    }
  };

  const handleOpenCreateChannel = (categoryId?: string) => {
    setCreateTargetCategoryId(categoryId);
    setNewChannelName('');
    setNewChannelTopic('');
    setNewChannelType('text');
    setIsCreatingChannel(true);
  };

  const handleConfirmCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    setChannelActionLoading(true);
    try {
      if (onCreateRelay) {
        await onCreateRelay(newChannelName.trim(), newChannelType, newChannelTopic.trim(), createTargetCategoryId);
      }
      setIsCreatingChannel(false);
      setNewChannelName('');
      setNewChannelTopic('');
    } finally {
      setChannelActionLoading(false);
    }
  };

  const handleConfirmCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setChannelActionLoading(true);
    try {
      if (onCreateCategory) {
        await onCreateCategory(newCategoryName.trim());
      }
      setIsCreatingCategory(false);
      setNewCategoryName('');
    } finally {
      setChannelActionLoading(false);
    }
  };

  const handleDeleteChannelConfirm = async () => {
    if (!channelToDelete) return;
    setChannelActionLoading(true);
    try {
      if (onDeleteRelay) {
        await onDeleteRelay(channelToDelete.id);
      }
      setChannelToDelete(null);
    } finally {
      setChannelActionLoading(false);
    }
  };

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
      localStorage.setItem(`subspace_onboarding_${serverId}`, JSON.stringify({
        requiresOnboarding,
        rulesText,
        defaultChannels,
        onboardingQuestions,
      }));
      if (onUpdateOnboardingQuestions) {
        onUpdateOnboardingQuestions(onboardingQuestions);
      }
      setOnboardingSaved(true);
      setTimeout(() => setOnboardingSaved(false), 2000);
    } catch { /* noop */ }
  };

  const handleSaveDiscovery = async () => {
    try {
      await api.updateBeacon(serverId, { 
        isDiscoverable, 
        description: discoveryDescription, 
        bannerUrl: discoveryBannerUrl.trim() || null,
        category: discoveryCategory
      });
      localStorage.setItem(`subspace_discovery_${serverId}`, JSON.stringify({
        isDiscoverable,
        description: discoveryDescription,
        bannerUrl: discoveryBannerUrl,
        category: discoveryCategory,
      }));
      setDiscoverySaved(true);
      setTimeout(() => setDiscoverySaved(false), 2000);
    } catch { /* noop */ }
  };

  const handleSaveNotifications = () => {
    try {
      localStorage.setItem(`subspace_notif_${serverId}`, JSON.stringify({
        notifyLevel,
        suppressEveryone,
        suppressRoles,
        muteServer,
      }));
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 2000);
    } catch { /* noop */ }
  };

  const handleSavePrivacy = () => {
    try {
      localStorage.setItem(`subspace_privacy_${serverId}`, JSON.stringify({
        allowDms,
        filterExplicit,
        restrictedActivity,
      }));
      setPrivacySaved(true);
      setTimeout(() => setPrivacySaved(false), 2000);
    } catch { /* noop */ }
  };

  useEffect(() => {
    setNameInput(serverName);
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
    if (serverId) {
      try {
        const savedNotif = localStorage.getItem(`subspace_notif_${serverId}`);
        if (savedNotif) {
          const parsed = JSON.parse(savedNotif);
          if (parsed.notifyLevel) setNotifyLevel(parsed.notifyLevel);
          if (typeof parsed.suppressEveryone === 'boolean') setSuppressEveryone(parsed.suppressEveryone);
          if (typeof parsed.suppressRoles === 'boolean') setSuppressRoles(parsed.suppressRoles);
          if (typeof parsed.muteServer === 'boolean') setMuteServer(parsed.muteServer);
        }
        const savedPrivacy = localStorage.getItem(`subspace_privacy_${serverId}`);
        if (savedPrivacy) {
          const parsed = JSON.parse(savedPrivacy);
          if (typeof parsed.allowDms === 'boolean') setAllowDms(parsed.allowDms);
          if (parsed.filterExplicit) setFilterExplicit(parsed.filterExplicit);
          if (typeof parsed.restrictedActivity === 'boolean') setRestrictedActivity(parsed.restrictedActivity);
        }
      } catch { /* noop */ }
    }
  }, [serverName, isOpen, initialTab, serverId]);

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
            onClick={() => setActiveTab('notifications')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors flex items-center gap-2 ${
              activeTab === 'notifications' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notification Settings</span>
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors flex items-center gap-2 ${
              activeTab === 'privacy' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Privacy & Safety</span>
          </button>
          <button
            onClick={() => setActiveTab('insights')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] transition-colors flex items-center gap-2 ${
              activeTab === 'insights' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Server Insights</span>
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
                            <div className="w-8 h-4 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:bg-[#23a55a] peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-disabled:opacity-40" />
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
                            <div className="w-8 h-4 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:bg-[#23a55a] peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all" />
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
              {/* Header with Title and Action Buttons */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#1f2024]">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Hash className="w-4 h-4 text-[#00f0ff]" />
                    <span>Relay & Channel Management</span>
                  </h3>
                  <p className="text-xs text-[#949ba4] mt-0.5">
                    Configure frequency channels, edit topics, manage core priority relays, and organize categories.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreatingCategory(true)}
                    className="px-3 py-1.5 rounded-[4px] bg-[#1e1f22] hover:bg-[#2b2d31] text-[#dbdee1] hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors border border-[#2b2d31]"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-[#949ba4]" />
                    <span>Create Category</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateChannel()}
                    className="px-3 py-1.5 rounded-[4px] bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Channel</span>
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#80848e]" />
                <input
                  type="text"
                  placeholder="Filter channels by name or topic..."
                  value={channelSearch}
                  onChange={(e) => setChannelSearch(e.target.value)}
                  className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/50 rounded-[6px] pl-9 pr-8 py-2 text-xs text-white placeholder-[#80848e] outline-none transition-colors"
                />
                {channelSearch && (
                  <button
                    type="button"
                    onClick={() => setChannelSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#80848e] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Channel Categories & Relays List */}
              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                {categories.length === 0 ? (
                  <div className="p-8 rounded-[8px] bg-[#111214] border border-[#1f2024] text-center space-y-2">
                    <Hash className="w-8 h-8 text-[#4e5058] mx-auto" />
                    <div className="text-sm font-semibold text-white">No Relays Configured</div>
                    <div className="text-xs text-[#949ba4]">This Beacon does not have any active channels.</div>
                  </div>
                ) : (
                  categories.map((cat) => {
                    const filteredChannels = cat.channels.filter(ch => 
                      !channelSearch.trim() ||
                      ch.name.toLowerCase().includes(channelSearch.toLowerCase().trim()) ||
                      (ch.description && ch.description.toLowerCase().includes(channelSearch.toLowerCase().trim()))
                    );

                    if (channelSearch.trim() && filteredChannels.length === 0) {
                      return null;
                    }

                    return (
                      <div key={cat.id} className="rounded-[8px] bg-[#111214] border border-[#1f2024] overflow-hidden">
                        {/* Category Header */}
                        <div className="flex items-center justify-between px-3 py-2 bg-[#0b0c0e] border-b border-[#1f2024]">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold tracking-wider text-[#949ba4] uppercase">
                              {cat.name}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1f2024] text-[#80848e]">
                              {filteredChannels.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenCreateChannel(cat.id)}
                            title={`Add channel to ${cat.name}`}
                            className="p-1 rounded hover:bg-[#1f2024] text-[#949ba4] hover:text-white transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Channels List */}
                        <div className="p-2 space-y-1.5">
                          {filteredChannels.length === 0 ? (
                            <div className="text-center py-3 text-xs text-[#80848e] italic">
                              No channels match search in this category.
                            </div>
                          ) : (
                            filteredChannels.map((ch) => {
                              const isEditing = editingChannelId === ch.id;

                              let TypeIcon = Hash;
                              let iconColor = 'text-[#949ba4]';
                              let typeLabel = 'Text';
                              if (ch.type === 'voice') {
                                TypeIcon = Volume2;
                                iconColor = 'text-[#23a55a]';
                                typeLabel = 'Voice';
                              } else if (ch.type === 'announcement') {
                                TypeIcon = Radio;
                                iconColor = 'text-[#f0b232]';
                                typeLabel = 'Announcement';
                              } else if (ch.type === 'archive') {
                                TypeIcon = Archive;
                                iconColor = 'text-[#00f0ff]';
                                typeLabel = 'Forum';
                              } else if (ch.type === 'gallery') {
                                TypeIcon = ImageIcon;
                                iconColor = 'text-[#eb459e]';
                                typeLabel = 'Gallery';
                              }

                              return (
                                <div
                                  key={ch.id}
                                  className={`rounded-[6px] border transition-all ${
                                    isEditing 
                                      ? 'bg-[#18191c] border-[#00f0ff]/50 p-3 shadow-md' 
                                      : 'bg-[#16171a]/70 hover:bg-[#1c1d22] border-[#1f2024] p-2.5 flex items-center justify-between gap-3'
                                  }`}
                                >
                                  {isEditing ? (
                                    <div className="space-y-3 w-full">
                                      <div className="text-xs font-bold text-white flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          <TypeIcon className={`w-3.5 h-3.5 ${iconColor}`} />
                                          <span>Edit Channel #{ch.name}</span>
                                        </div>
                                        {ch.isUnhideable && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/30 flex items-center gap-1">
                                            <Shield className="w-2.5 h-2.5" /> Core Relay
                                          </span>
                                        )}
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1">
                                            Channel Name
                                          </label>
                                          <input
                                            type="text"
                                            value={editChannelName}
                                            onChange={(e) => setEditChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                                            className="w-full bg-[#111214] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white outline-none"
                                            placeholder="channel-name"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1">
                                            Channel Topic
                                          </label>
                                          <input
                                            type="text"
                                            value={editChannelTopic}
                                            onChange={(e) => setEditChannelTopic(e.target.value)}
                                            className="w-full bg-[#111214] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white outline-none"
                                            placeholder="Add operational topic or guidelines..."
                                          />
                                        </div>
                                      </div>

                                      <div className="flex items-center justify-end gap-2 pt-1">
                                        <button
                                          type="button"
                                          onClick={() => setEditingChannelId(null)}
                                          className="px-2.5 py-1 rounded text-xs text-[#949ba4] hover:text-white hover:bg-[#2b2d31] transition-colors"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          disabled={channelActionLoading || !editChannelName.trim()}
                                          onClick={() => handleSaveEditChannel(ch.id)}
                                          className="px-3 py-1 rounded bg-[#23a55a] hover:bg-[#1a7f45] text-white text-xs font-semibold transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                          <span>Save Changes</span>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      {/* Left: Icon, Name, Topic & Badges */}
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <div className="w-7 h-7 rounded-[6px] bg-[#111214] border border-[#1f2024] flex items-center justify-center shrink-0">
                                          <TypeIcon className={`w-3.5 h-3.5 ${iconColor}`} />
                                        </div>

                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-white truncate">
                                              #{ch.name}
                                            </span>

                                            {/* Badges */}
                                            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase bg-[#1f2024] text-[#80848e]">
                                              {typeLabel}
                                            </span>

                                            {ch.isUnhideable && (
                                              <span 
                                                title="Core Priority Relay - Protected channel that cannot be hidden or removed"
                                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/30 flex items-center gap-1 shrink-0"
                                              >
                                                <Shield className="w-2.5 h-2.5" /> Core Relay
                                              </span>
                                            )}

                                            {ch.isHidden && (
                                              <span 
                                                title="Hidden from regular transmitter views"
                                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#2b2d31] text-[#949ba4] flex items-center gap-1 shrink-0"
                                              >
                                                <EyeOff className="w-2.5 h-2.5" /> Hidden
                                              </span>
                                            )}
                                          </div>

                                          <div className="text-[11px] text-[#80848e] truncate mt-0.5">
                                            {ch.description ? ch.description : <span className="italic opacity-60">No topic set</span>}
                                          </div>
                                        </div>
                                      </div>

                                      {/* Right: Actions */}
                                      <div className="flex items-center gap-1 shrink-0">
                                        {/* Edit Button */}
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditChannel(ch)}
                                          title="Edit channel name and topic"
                                          className="p-1.5 rounded hover:bg-[#2b2d31] text-[#949ba4] hover:text-white transition-colors"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>

                                        {/* Visibility Toggle Button */}
                                        {onToggleRelayVisibility && (
                                          <button
                                            type="button"
                                            disabled={Boolean(ch.isUnhideable && !ch.isHidden)}
                                            onClick={() => onToggleRelayVisibility(ch.id, !ch.isHidden)}
                                            title={
                                              ch.isUnhideable && !ch.isHidden
                                                ? 'Core priority relay cannot be hidden'
                                                : ch.isHidden
                                                ? 'Unhide channel'
                                                : 'Hide channel'
                                            }
                                            className={`p-1.5 rounded transition-colors ${
                                              ch.isUnhideable && !ch.isHidden
                                                ? 'opacity-30 cursor-not-allowed text-[#80848e]'
                                                : 'hover:bg-[#2b2d31] text-[#949ba4] hover:text-white'
                                            }`}
                                          >
                                            {ch.isHidden ? (
                                              <EyeOff className="w-3.5 h-3.5 text-[#f23f43]" />
                                            ) : (
                                              <Eye className="w-3.5 h-3.5 text-[#23a55a]" />
                                            )}
                                          </button>
                                        )}

                                        {/* Delete Button */}
                                        {onDeleteRelay && (
                                          <button
                                            type="button"
                                            disabled={Boolean(ch.isUnhideable)}
                                            onClick={() => setChannelToDelete(ch)}
                                            title={ch.isUnhideable ? 'Core relays cannot be deleted' : 'Delete channel'}
                                            className={`p-1.5 rounded transition-colors ${
                                              ch.isUnhideable 
                                                ? 'opacity-20 cursor-not-allowed text-[#80848e]' 
                                                : 'hover:bg-[#da373c]/20 text-[#949ba4] hover:text-[#fa777c]'
                                            }`}
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Create Channel Modal / Sub-card */}
              {isCreatingChannel && (
                <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-md bg-[#111214] border border-[#1f2024] rounded-[10px] shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Plus className="w-4 h-4 text-[#00f0ff]" />
                        <span>Create Relay Channel</span>
                      </h4>
                      <button
                        type="button"
                        onClick={() => setIsCreatingChannel(false)}
                        className="text-[#80848e] hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <form onSubmit={handleConfirmCreateChannel} className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1.5">
                          Channel Type
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { type: 'text', label: 'Text Relay', icon: Hash, desc: 'Messages & media' },
                            { type: 'voice', label: 'Voice Bridge', icon: Volume2, desc: 'Audio & holo-cast' },
                            { type: 'announcement', label: 'Announcement', icon: Radio, desc: 'Official broadcasts' },
                            { type: 'archive', label: 'Forum Board', icon: Archive, desc: 'Organized threads' },
                          ].map((t) => {
                            const IconComponent = t.icon;
                            const isSelected = newChannelType === t.type;
                            return (
                              <button
                                key={t.type}
                                type="button"
                                onClick={() => setNewChannelType(t.type as any)}
                                className={`flex items-start gap-2 p-2.5 rounded-[6px] text-left border transition-all ${
                                  isSelected 
                                    ? 'bg-[#5865f2]/10 border-[#5865f2] text-white' 
                                    : 'bg-[#16171a] border-[#1f2024] text-[#949ba4] hover:border-[#2b2d31]'
                                }`}
                              >
                                <IconComponent className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-[#5865f2]' : 'text-[#80848e]'}`} />
                                <div>
                                  <div className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-[#dbdee1]'}`}>{t.label}</div>
                                  <div className="text-[10px] text-[#80848e]">{t.desc}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1">
                          Channel Name
                        </label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[#80848e]">#</span>
                          <input
                            type="text"
                            required
                            placeholder="new-relay"
                            value={newChannelName}
                            onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                            className="w-full bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] pl-6 pr-2.5 py-1.5 text-xs text-white placeholder-[#80848e] outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1">
                          Channel Topic (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="Purpose of this channel..."
                          value={newChannelTopic}
                          onChange={(e) => setNewChannelTopic(e.target.value)}
                          className="w-full bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white placeholder-[#80848e] outline-none"
                        />
                      </div>

                      {categories.length > 0 && (
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1">
                            Target Category
                          </label>
                          <select
                            value={createTargetCategoryId || ''}
                            onChange={(e) => setCreateTargetCategoryId(e.target.value || undefined)}
                            className="w-full bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white outline-none"
                          >
                            <option value="">Auto-Assign by Type</option>
                            {categories.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f2024]">
                        <button
                          type="button"
                          onClick={() => setIsCreatingChannel(false)}
                          className="px-3 py-1.5 rounded text-xs text-[#949ba4] hover:text-white hover:bg-[#1e1f22] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={channelActionLoading || !newChannelName.trim()}
                          className="px-4 py-1.5 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Create Channel</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Create Category Modal */}
              {isCreatingCategory && (
                <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-sm bg-[#111214] border border-[#1f2024] rounded-[10px] shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <FolderPlus className="w-4 h-4 text-[#00f0ff]" />
                        <span>Create Category</span>
                      </h4>
                      <button
                        type="button"
                        onClick={() => setIsCreatingCategory(false)}
                        className="text-[#80848e] hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <form onSubmit={handleConfirmCreateCategory} className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1">
                          Category Name
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. OPERATIONS & INTEL"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          className="w-full bg-[#1e1f22] border border-[#2b2d31] focus:border-[#00f0ff]/50 rounded-[4px] px-2.5 py-1.5 text-xs text-white placeholder-[#80848e] outline-none"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f2024]">
                        <button
                          type="button"
                          onClick={() => setIsCreatingCategory(false)}
                          className="px-3 py-1.5 rounded text-xs text-[#949ba4] hover:text-white hover:bg-[#1e1f22] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={channelActionLoading || !newCategoryName.trim()}
                          className="px-4 py-1.5 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          <span>Create Category</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Delete Channel Confirmation Dialog */}
              {channelToDelete && (
                <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-sm bg-[#111214] border border-[#da373c]/40 rounded-[10px] shadow-2xl p-5 space-y-3 animate-in fade-in zoom-in-95">
                    <div className="flex items-center gap-2 text-[#da373c]">
                      <AlertCircle className="w-5 h-5" />
                      <h4 className="text-sm font-bold text-white">Delete Channel</h4>
                    </div>
                    <p className="text-xs text-[#dbdee1]">
                      Are you sure you want to delete <span className="font-bold text-white">#{channelToDelete.name}</span>? All transmissions and archival logs in this channel will be permanently removed. This action cannot be undone.
                    </p>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setChannelToDelete(null)}
                        className="px-3 py-1.5 rounded text-xs text-[#949ba4] hover:text-white hover:bg-[#1e1f22] transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={channelActionLoading}
                        onClick={handleDeleteChannelConfirm}
                        className="px-4 py-1.5 rounded bg-[#da373c] hover:bg-[#ba2e33] text-white text-xs font-semibold transition-colors shadow-sm flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Channel</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Community Onboarding</h3>
                <p className="text-xs text-[#949ba4]">
                  Design the new member experience with default channels, starter questions for roles, and server rules.
                </p>
              </div>

              {/* Enable / Disable Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-[#111214] border border-[#1f2024] rounded-[8px]">
                <div>
                  <div className="text-xs font-semibold text-white">Enable Community Onboarding</div>
                  <div className="text-[10px] text-[#949ba4] mt-0.5">Prompt new recruits with role selection and channel discovery upon joining.</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={requiresOnboarding}
                    onChange={() => setRequiresOnboarding(v => !v)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                </label>
              </div>

              {/* Section 1: Default Channels */}
              <div className="space-y-2 p-4 bg-[#111214] border border-[#1f2024] rounded-[8px]">
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-[#00f0ff]" />
                  <label className="text-xs font-bold uppercase tracking-wider text-white">
                    Default Channels
                  </label>
                </div>
                <p className="text-xs text-[#949ba4]">
                  Channels that all members are automatically assigned to upon joining.
                </p>
                <div className="flex items-center gap-2 flex-wrap pt-2">
                  {['welcome', 'announcements', 'rules', 'general', 'bot-commands', 'voice-lounge'].map(chan => {
                    const isSelected = defaultChannels.includes(chan);
                    return (
                      <button
                        key={chan}
                        type="button"
                        onClick={() => {
                          setDefaultChannels(prev => 
                            isSelected ? prev.filter(c => c !== chan) : [...prev, chan]
                          );
                        }}
                        className={`px-3 py-1.5 rounded-[6px] text-xs font-medium border flex items-center gap-1.5 transition-colors ${
                          isSelected
                            ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                            : 'bg-[#16171a] border-[#1f2024] text-[#949ba4] hover:text-white'
                        }`}
                      >
                        <Hash className="w-3 h-3 text-[#00f0ff]" />
                        <span>{chan}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#5865f2]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Custom Questions (Role and Channel Selection) */}
              <div className="space-y-3 p-4 bg-[#111214] border border-[#1f2024] rounded-[8px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-[#00f0ff]" />
                    <label className="text-xs font-bold uppercase tracking-wider text-white">
                      Custom Onboarding Questions
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newQ: OnboardingQuestion = {
                        id: `q-${Date.now()}`,
                        title: '',
                        description: '',
                        timing: 'join_and_browse',
                        options: [
                          { id: `opt-${Date.now()}-1`, label: 'Specialist Option', roleId: clearancesList[0]?.id },
                          { id: `opt-${Date.now()}-2`, label: 'Alternative Specialty', roleId: clearancesList[1]?.id || clearancesList[0]?.id },
                        ],
                      };
                      setOnboardingQuestions(prev => [...prev, newQ]);
                    }}
                    className="px-2.5 py-1 bg-[#5865f2] hover:bg-[#4752c4] text-white text-[11px] font-semibold rounded-[4px] flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Question</span>
                  </button>
                </div>
                <p className="text-xs text-[#949ba4]">
                  Ask questions to automatically assign roles or unlock specific frequency relays based on answers.
                </p>

                <div className="space-y-4 pt-2">
                  {onboardingQuestions.map((q, qIndex) => (
                    <div key={q.id} className="p-4 bg-[#111214] border border-[#1f2024] hover:border-[#2b2d31] rounded-[8px] space-y-3 transition-all">
                      {/* Question Header: Number + Full-width Title Input + Remove Button */}
                      <div className="flex items-center gap-2.5 w-full">
                        <span className="w-6 h-6 rounded-full bg-[#1f2024] text-xs font-bold text-[#00f0ff] flex items-center justify-center shrink-0 border border-[#00f0ff]/30">
                          {qIndex + 1}
                        </span>
                        <input
                          type="text"
                          value={q.title}
                          onChange={(e) => {
                            const updatedTitle = e.target.value;
                            setOnboardingQuestions(prev => prev.map(item => item.id === q.id ? { ...item, title: updatedTitle } : item));
                          }}
                          placeholder="e.g. What is your primary operational role?"
                          className="flex-1 min-w-0 bg-[#16171a] border border-[#2b2d31] focus:border-[#00f0ff]/70 rounded-[6px] px-3 py-1.5 text-xs font-semibold text-white placeholder-[#80848e] outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setOnboardingQuestions(prev => prev.filter(item => item.id !== q.id))}
                          className="text-[#80848e] hover:text-[#f23f43] p-1.5 rounded hover:bg-[#da373c]/10 transition-colors shrink-0"
                          title="Remove Question"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Question Description / Subtitle */}
                      <div className="pl-8">
                        <input
                          type="text"
                          value={q.description || ''}
                          onChange={(e) => {
                            const updatedDesc = e.target.value;
                            setOnboardingQuestions(prev => prev.map(item => item.id === q.id ? { ...item, description: updatedDesc } : item));
                          }}
                          placeholder="Optional description or instructions for new members..."
                          className="w-full bg-[#0b0c0e] border border-[#1f2024] focus:border-[#00f0ff]/40 rounded-[4px] px-2.5 py-1 text-[11px] text-[#dbdee1] placeholder-[#80848e] outline-none transition-colors"
                        />
                      </div>

                      {/* Question Timing / Placement Selector (The 2 Types: Join+Browse vs Browse Only) */}
                      <div className="pl-8 pt-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949ba4] mb-1.5">
                          Question Placement &amp; Visibility
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setOnboardingQuestions(prev => prev.map(item => item.id === q.id ? { ...item, timing: 'join_and_browse' } : item));
                            }}
                            className={`p-2.5 rounded-[6px] text-left border transition-all ${
                              q.timing !== 'browse_only'
                                ? 'bg-[#00f0ff]/10 border-[#00f0ff]/60 text-white'
                                : 'bg-[#0b0c0e] border-[#1f2024] text-[#80848e] hover:border-[#2b2d31]'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                              <span className={`w-2 h-2 rounded-full ${q.timing !== 'browse_only' ? 'bg-[#00f0ff]' : 'bg-[#4e5058]'}`} />
                              <span>Ask Before Member Joins &amp; in Channels</span>
                            </div>
                            <p className="text-[10px] text-[#949ba4] mt-1 leading-snug">
                              Shown in the welcome onboarding screen when a member joins, and always accessible in Channels &amp; Roles.
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setOnboardingQuestions(prev => prev.map(item => item.id === q.id ? { ...item, timing: 'browse_only' } : item));
                            }}
                            className={`p-2.5 rounded-[6px] text-left border transition-all ${
                              q.timing === 'browse_only'
                                ? 'bg-[#5865f2]/10 border-[#5865f2]/60 text-white'
                                : 'bg-[#0b0c0e] border-[#1f2024] text-[#80848e] hover:border-[#2b2d31]'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                              <span className={`w-2 h-2 rounded-full ${q.timing === 'browse_only' ? 'bg-[#5865f2]' : 'bg-[#4e5058]'}`} />
                              <span>Ask in Channels &amp; Roles Only</span>
                            </div>
                            <p className="text-[10px] text-[#949ba4] mt-1 leading-snug">
                              Skipped on initial join. Members can find and answer this question later under Channels &amp; Roles.
                            </p>
                          </button>
                        </div>
                      </div>

                      {/* Answers / Options with Grantable Roles */}
                      <div className="pl-8 pt-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#949ba4]">
                            Options &amp; Granted Roles
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newOptId = `opt-${Date.now()}`;
                              setOnboardingQuestions(prev => prev.map(item => {
                                if (item.id !== q.id) return item;
                                return {
                                  ...item,
                                  options: [
                                    ...item.options,
                                    { id: newOptId, label: 'New Option', roleId: clearancesList[0]?.id },
                                  ],
                                };
                              }));
                            }}
                            className="text-[11px] font-semibold text-[#00f0ff] hover:text-[#33f3ff] flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" /> Add Option
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {q.options.map((opt, optIndex) => {
                            const assignedRole = clearancesList.find(c => c.id === opt.roleId);
                            return (
                              <div key={opt.id || optIndex} className="flex items-center gap-2 bg-[#0b0c0e] border border-[#1f2024] rounded-[6px] p-2 text-xs">
                                <span className="text-[#80848e] shrink-0">•</span>
                                <input
                                  type="text"
                                  value={opt.label}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setOnboardingQuestions(prev => prev.map(item => {
                                      if (item.id !== q.id) return item;
                                      const updated = [...item.options];
                                      updated[optIndex] = { ...updated[optIndex], label: val };
                                      return { ...item, options: updated };
                                    }));
                                  }}
                                  placeholder="Option name..."
                                  className="bg-transparent text-white font-medium outline-none flex-1 min-w-0"
                                />

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[10px] text-[#80848e]">Grants:</span>
                                  <div className="flex items-center gap-1.5 bg-[#16171a] border border-[#2b2d31] rounded px-2 py-0.5">
                                    {assignedRole?.color && (
                                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: assignedRole.color }} />
                                    )}
                                    <select
                                      value={opt.roleId || ''}
                                      onChange={(e) => {
                                        const targetRoleId = e.target.value;
                                        setOnboardingQuestions(prev => prev.map(item => {
                                          if (item.id !== q.id) return item;
                                          const updatedOpts = [...item.options];
                                          updatedOpts[optIndex] = { ...updatedOpts[optIndex], roleId: targetRoleId };
                                          return { ...item, options: updatedOpts };
                                        }));
                                      }}
                                      className="bg-transparent text-[#00f0ff] text-[11px] font-semibold outline-none cursor-pointer"
                                    >
                                      {clearancesList.map(c => (
                                        <option key={c.id} value={c.id} className="bg-[#1e1f22] text-white">
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {q.options.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOnboardingQuestions(prev => prev.map(item => {
                                          if (item.id !== q.id) return item;
                                          return { ...item, options: item.options.filter((_, idx) => idx !== optIndex) };
                                        }));
                                      }}
                                      className="text-[#80848e] hover:text-[#f23f43] p-1 rounded transition-colors"
                                      title="Delete Option"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3: Rules & Welcome Text */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#949ba4] uppercase tracking-wider">
                  Rules &amp; Welcome Text
                </label>
                <textarea
                  value={rulesText}
                  onChange={e => setRulesText(e.target.value)}
                  rows={4}
                  className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-[#dbdee1] placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none transition-colors leading-relaxed"
                  placeholder="Enter your server rules and welcome message here…"
                />
                <div className="text-[10px] text-[#80848e]">
                  Supports markdown. Members must read and accept this before gaining send clearance.
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
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Beacon Discovery</h3>
                <p className="text-xs text-[#949ba4]">
                  Make your community visible in public discovery with banners, descriptions, and category tags.
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
                      When enabled, anyone across Subspace can find and join this beacon in Explore Communities.
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
                  <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                </label>
              </div>

              {/* Discovery Description */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                  Server Description
                </label>
                <textarea
                  value={discoveryDescription}
                  onChange={e => setDiscoveryDescription(e.target.value)}
                  maxLength={250}
                  rows={3}
                  className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] p-3 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none leading-relaxed"
                  placeholder="Briefly describe what your server is about for prospective recruits in Discovery..."
                />
                <div className="flex justify-between text-[10px] text-[#80848e]">
                  <span>Appears on your discovery card and server overview.</span>
                  <span>{discoveryDescription.length} / 250</span>
                </div>
              </div>

              {/* Server Banner URL with Live Preview */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                  Server Banner Image
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <ImageIcon className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#80848e]" />
                    <input
                      type="text"
                      value={discoveryBannerUrl}
                      onChange={e => setDiscoveryBannerUrl(e.target.value)}
                      placeholder="https://images.unsplash.com/... (16:9 banner image URL)"
                      className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] pl-9 pr-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
                    />
                  </div>
                </div>

                {/* Banner Live Preview Card */}
                <div className="mt-2 rounded-[12px] overflow-hidden border border-[#1f2024] bg-[#0c0d0e] max-w-sm">
                  <div className="h-28 w-full bg-[#16171a] relative overflow-hidden">
                    {discoveryBannerUrl ? (
                      <img
                        src={discoveryBannerUrl}
                        alt="Banner Preview"
                        className="w-full h-full object-cover"
                        onError={(e: any) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#80848e] text-xs font-mono">
                        <span>No banner image set</span>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-xs font-bold text-white truncate">{serverName}</div>
                    <div className="text-[11px] text-[#949ba4] line-clamp-2 mt-0.5">
                      {discoveryDescription || 'No description provided.'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Primary Category Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                  Primary Category
                </label>
                <select
                  value={discoveryCategory}
                  onChange={e => setDiscoveryCategory(e.target.value)}
                  className="w-full max-w-xs bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                >
                  <option value="Gaming">Gaming</option>
                  <option value="Music">Music</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Science & Tech">Science &amp; Tech</option>
                  <option value="Education">Education</option>
                  <option value="Student Hubs">Student Hubs</option>
                  <option value="General">General Community</option>
                </select>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-2">
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

          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Server Notification Settings</h3>
                <p className="text-xs text-[#949ba4]">Configure default transmission alerts and frequency ping rules for this beacon.</p>
              </div>

              {/* Default Notification Level */}
              <div className="space-y-3">
                <label className="text-[11px] uppercase font-bold text-[#b5bac1] tracking-wider">
                  Default Notification Level
                </label>
                <div className="space-y-2">
                  {[
                    { id: 'all', label: 'All Messages', desc: 'Get notified for every transmission sent in this beacon.' },
                    { id: 'mentions', label: 'Only @mentions', desc: 'Recommended — Only receive alerts when you or your clearance roles are mentioned.' },
                    { id: 'nothing', label: 'Nothing', desc: 'Suppress all notification badges and push alerts.' },
                  ].map(option => (
                    <label
                      key={option.id}
                      onClick={() => setNotifyLevel(option.id as any)}
                      className={`flex items-start gap-3 p-3 rounded-[8px] border cursor-pointer transition-all ${
                        notifyLevel === option.id
                          ? 'bg-[#1a1b1e] border-[#00f0ff]/60 shadow-[0_0_12px_rgba(0,240,255,0.1)]'
                          : 'bg-[#111214] border-[#1f2024] hover:bg-[#16171a]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="notifyLevel"
                        checked={notifyLevel === option.id}
                        onChange={() => setNotifyLevel(option.id as any)}
                        className="mt-0.5 accent-[#00f0ff]"
                      />
                      <div>
                        <div className="text-xs font-semibold text-white">{option.label}</div>
                        <div className="text-[11px] text-[#949ba4] mt-0.5">{option.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Ping Suppressions */}
              <div className="space-y-3 pt-2">
                <label className="text-[11px] uppercase font-bold text-[#b5bac1] tracking-wider">
                  Notification Overrides
                </label>
                
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Suppress @everyone and @here</div>
                    <div className="text-[11px] text-[#949ba4] mt-0.5">Prevent high-priority broadcast pings from creating desktop or mobile pings.</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={suppressEveryone}
                      onChange={() => setSuppressEveryone(v => !v)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                  </label>
                </div>

                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Suppress All Role @mentions</div>
                    <div className="text-[11px] text-[#949ba4] mt-0.5">Silence mentions directed at your specific clearance and tactical roles.</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={suppressRoles}
                      onChange={() => setSuppressRoles(v => !v)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                  </label>
                </div>

                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Mute Fleet Station</div>
                    <div className="text-[11px] text-[#949ba4] mt-0.5">Silences all unread notifications, sound alerts, and channel unread pill markers.</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={muteServer}
                      onChange={() => setMuteServer(v => !v)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#f23f43]" />
                  </label>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSaveNotifications}
                  className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold text-xs rounded-[6px] transition-colors"
                >
                  Save Notification Settings
                </button>
                {notifSaved && (
                  <span className="text-xs text-[#23a55a] flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Privacy & Safety Controls</h3>
                <p className="text-xs text-[#949ba4]">Manage member interaction boundaries and incoming transmission filtering.</p>
              </div>

              {/* Direct Messages */}
              <div className="space-y-3">
                <label className="text-[11px] uppercase font-bold text-[#b5bac1] tracking-wider">
                  Direct Messages
                </label>
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Allow Direct Transmissions</div>
                    <div className="text-[11px] text-[#949ba4] mt-0.5">Allow members in this beacon to send you private quantum direct transmissions.</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={allowDms}
                      onChange={() => setAllowDms(v => !v)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                  </label>
                </div>
              </div>

              {/* Explicit Content Filter */}
              <div className="space-y-3 pt-2">
                <label className="text-[11px] uppercase font-bold text-[#b5bac1] tracking-wider">
                  Explicit Transmission Filter
                </label>
                <p className="text-xs text-[#949ba4]">Automatically scan and quarantine transmissions containing potential security or safety hazards.</p>
                <div className="space-y-2">
                  {[
                    { id: 'scan_all', label: 'Scan transmissions from all members', desc: 'Recommended for maximum station telemetry and operative safety.' },
                    { id: 'scan_non_friends', label: 'Do not scan transmissions from trusted friends', desc: 'Transmissions from verified friend operatives will bypass scanner protocols.' },
                    { id: 'disabled', label: 'Do not scan any transmissions', desc: 'Transmissions will not be inspected. Not recommended for public beacons.' },
                  ].map(lvl => (
                    <label
                      key={lvl.id}
                      onClick={() => setFilterExplicit(lvl.id as any)}
                      className={`flex items-start gap-3 p-3 rounded-[8px] border cursor-pointer transition-all ${
                        filterExplicit === lvl.id
                          ? 'bg-[#1a1b1e] border-[#23a55a]/60 shadow-[0_0_12px_rgba(35,165,90,0.1)]'
                          : 'bg-[#111214] border-[#1f2024] hover:bg-[#16171a]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="filterExplicit"
                        checked={filterExplicit === lvl.id}
                        onChange={() => setFilterExplicit(lvl.id as any)}
                        className="mt-0.5 accent-[#23a55a]"
                      />
                      <div>
                        <div className="text-xs font-semibold text-white">{lvl.label}</div>
                        <div className="text-[11px] text-[#949ba4] mt-0.5">{lvl.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Activity Sharing */}
              <div className="space-y-3 pt-2">
                <label className="text-[11px] uppercase font-bold text-[#b5bac1] tracking-wider">
                  Telemetry Sharing
                </label>
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Restrict Tactical Activity Sharing</div>
                    <div className="text-[11px] text-[#949ba4] mt-0.5">Hide your current game or Holo-Cast activity status from operatives in this server.</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={restrictedActivity}
                      onChange={() => setRestrictedActivity(v => !v)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#2b2d31] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#23a55a]" />
                  </label>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSavePrivacy}
                  className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold text-xs rounded-[6px] transition-colors"
                >
                  Save Privacy Settings
                </button>
                {privacySaved && (
                  <span className="text-xs text-[#23a55a] flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>
            </div>
          )}

          {activeTab === 'insights' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Server Insights & Telemetry</h3>
                <p className="text-xs text-[#949ba4]">Fleet station transmission metrics, operative engagement, and frequency stability.</p>
              </div>

              {/* Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024]">
                  <div className="text-[10px] uppercase font-bold text-[#80848e]">Active Operatives</div>
                  <div className="text-xl font-bold text-white mt-1">48</div>
                  <div className="text-[10px] text-[#23a55a] mt-0.5 font-medium">+12% vs last week</div>
                </div>
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024]">
                  <div className="text-[10px] uppercase font-bold text-[#80848e]">Voice Minutes</div>
                  <div className="text-xl font-bold text-[#00f0ff] mt-1">3,420m</div>
                  <div className="text-[10px] text-[#23a55a] mt-0.5 font-medium">+28% frequency</div>
                </div>
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024]">
                  <div className="text-[10px] uppercase font-bold text-[#80848e]">Msg Velocity</div>
                  <div className="text-xl font-bold text-white mt-1">142/hr</div>
                  <div className="text-[10px] text-[#949ba4] mt-0.5 font-medium">Peak: 480/hr</div>
                </div>
                <div className="p-3.5 rounded-[8px] bg-[#111214] border border-[#1f2024]">
                  <div className="text-[10px] uppercase font-bold text-[#80848e]">Retention Rate</div>
                  <div className="text-xl font-bold text-[#23a55a] mt-1">96.4%</div>
                  <div className="text-[10px] text-[#23a55a] mt-0.5 font-medium">Quantum-stable</div>
                </div>
              </div>

              {/* Telemetry Activity Chart (CSS Bar Representation) */}
              <div className="p-4 rounded-[8px] bg-[#111214] border border-[#1f2024] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-white">Transmission Velocity (Last 12 Hours)</div>
                  <span className="text-[10px] text-[#00f0ff] font-mono">LIVE TELEMETRY</span>
                </div>

                <div className="h-28 flex items-end gap-2 pt-4 px-2 border-b border-[#1f2024]">
                  {[
                    { hour: '12h', val: 35 },
                    { hour: '11h', val: 50 },
                    { hour: '10h', val: 25 },
                    { hour: '9h', val: 65 },
                    { hour: '8h', val: 80 },
                    { hour: '7h', val: 45 },
                    { hour: '6h', val: 90 },
                    { hour: '5h', val: 100 },
                    { hour: '4h', val: 75 },
                    { hour: '3h', val: 60 },
                    { hour: '2h', val: 85 },
                    { hour: 'Now', val: 95 },
                  ].map((bar, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                      <div
                        style={{ height: `${bar.val}%` }}
                        className="w-full bg-gradient-to-t from-[#00f0ff]/40 to-[#00f0ff] rounded-t-[3px] group-hover:brightness-125 transition-all shadow-[0_0_8px_rgba(0,240,255,0.2)]"
                        title={`${bar.hour}: ${bar.val * 2} transmissions`}
                      />
                      <span className="text-[9px] text-[#80848e] font-mono truncate">{bar.hour}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Station Health Diagnostic */}
              <div className="p-3.5 rounded-[8px] bg-[#00f0ff]/5 border border-[#00f0ff]/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#00f0ff] animate-pulse" />
                  <div>
                    <div className="text-xs font-semibold text-white">Quantum Link Stability: 99.8%</div>
                    <div className="text-[11px] text-[#949ba4] mt-0.5">Subspace frequency coherence is optimal across all relays.</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-[#00f0ff] bg-[#00f0ff]/10 px-2 py-1 rounded">ALL SYSTEMS NOMINAL</span>
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
