import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Hash, 
  Volume2, 
  Folder, 
  FolderOpen, 
  Search, 
  Settings, 
  Shield, 
  Send, 
  Paperclip, 
  Mic, 
  MicOff, 
  Headphones, 
  Activity, 
  Archive,
  Image as ImageIcon,
  Users,
  Pin,
  X,
  Bell,
  CheckCircle2,
  Copy,
  Trash2,
  MessageSquare,
  Sparkles,
  Key
} from 'lucide-react';
import { 
  Modal, 
  Button, 
  Input, 
  ColorWheel, 
  FontSelector, 
  BadgeDeck, 
  THEME,
  ContextMenuProvider,
  useContextMenu,
  MessageActionBar,
  ProfileCard,
  ContextMenuItem,
  UserProfile
} from '@subspace/ui';
import { usePlatformEnvironment } from './usePlatformEnvironment';

// Interfaces
interface Beacon {
  id: string;
  name: string;
  clusterId?: string;
  icon?: string;
  unreadCount?: number;
}

interface Cluster {
  id: string;
  name: string;
  beaconIds: string[];
}

interface Channel {
  id: string;
  name: string;
  type: 'TEXT_RELAY' | 'COMM_LINK' | 'ARCHIVAL_RELAY' | 'VISUAL_RELAY';
  unread?: boolean;
}

interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

interface Message {
  id: string;
  author: string;
  callsign: string;
  avatar: string;
  content: string;
  timestamp: string;
  staffRank?: number;
  isPinned?: boolean;
  reactions?: MessageReaction[];
}

export const AppContent: React.FC = () => {
  const platform = usePlatformEnvironment();
  const { openContextMenu } = useContextMenu();

  // State
  const [selectedBeaconId, setSelectedBeaconId] = useState('beacon-prime');
  const [selectedChannelId, setSelectedChannelId] = useState('relay-general');
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({ 'cluster-ops': true });
  
  // Panels & Modals
  const [isQuickScanOpen, setIsQuickScanOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemberPanelOpen, setIsMemberPanelOpen] = useState(true);
  const [isPinnedDrawerOpen, setIsPinnedDrawerOpen] = useState(false);
  const [selectedUserProfile, setSelectedUserProfile] = useState<UserProfile | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [quickScanQuery, setQuickScanQuery] = useState('');

  // Settings State
  const [accentColor, setAccentColor] = useState('#00F0FF');
  const [selectedFont, setSelectedFont] = useState('default');
  const [messageInput, setMessageInput] = useState('');

  // Audio / Comm-Link state
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [inVoiceRoom, setInVoiceRoom] = useState(false);

  // Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Clusters & Beacons
  const [clusters] = useState<Cluster[]>([
    { id: 'cluster-ops', name: 'Fleet Operations', beaconIds: ['beacon-prime', 'beacon-tactical'] }
  ]);

  const [beacons, setBeacons] = useState<Beacon[]>([
    { id: 'beacon-prime', name: 'Aegis Command Station', unreadCount: 3 },
    { id: 'beacon-tactical', name: 'Vanguard Squadron' },
    { id: 'beacon-deep', name: 'Outer Rim Science Vessel' },
  ]);

  const [channels, setChannels] = useState<Channel[]>([
    { id: 'relay-announcements', name: 'high-priority-broadcasts', type: 'TEXT_RELAY' },
    { id: 'relay-general', name: 'quantum-transmissions', type: 'TEXT_RELAY' },
    { id: 'relay-archives', name: 'mission-flight-logs', type: 'ARCHIVAL_RELAY' },
    { id: 'relay-visuals', name: 'telemetry-recon-gallery', type: 'VISUAL_RELAY' },
    { id: 'comm-bridge', name: 'Bridge Comm-Link [Alpha]', type: 'COMM_LINK' },
  ]);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      author: 'Fleet Admiral Vance',
      callsign: 'adm_vance',
      avatar: '👨‍🚀',
      content: 'All subspace arrays report nominal frequency resonance across orbital sector 7.',
      timestamp: '14:22 UTC',
      staffRank: 3,
      isPinned: true,
      reactions: [{ emoji: '⚡', count: 4, users: ['Echo-4', 'Nova'] }, { emoji: '👍', count: 2, users: ['Orion'] }]
    },
    {
      id: 'm2',
      author: 'Echo-4 Specialist',
      callsign: 'echo_four',
      avatar: '🛰️',
      content: 'Acknowledged. Quantum bitfield clearances synchronized. Vault disclaimer confirmed.',
      timestamp: '14:25 UTC',
      staffRank: 1,
      reactions: [{ emoji: '🚀', count: 3, users: ['Vance'] }]
    },
  ]);

  // Transmitters / Members Mock
  const members: UserProfile[] = [
    {
      id: 'u1',
      name: 'Fleet Admiral Vance',
      callsign: 'adm_vance',
      avatar: '👨‍🚀',
      status: 'online',
      statusText: 'Directing orbital fleet tactical arrays',
      staffRank: 3,
      roles: ['High Command', 'Fleet Admiral', 'Quantum Level 5'],
      bio: 'Leading tactical subspace maneuvers for the Outer Rim Coalition since cycle 2021.',
      memberSince: '2021-04-12',
      quantumKeyFingerprint: 'SF-QKD-9981-FA23',
    },
    {
      id: 'u2',
      name: 'Command Officer (You)',
      callsign: 'cmdr_you',
      avatar: '⚡',
      status: 'online',
      statusText: 'Ghost Mode (Incognito)',
      staffRank: 2,
      roles: ['Command Staff', 'Sysop'],
      bio: 'Station Commander aboard Aegis Prime Subspace Hub.',
      memberSince: '2023-01-15',
      quantumKeyFingerprint: 'SF-QKD-4412-BB09',
    },
    {
      id: 'u3',
      name: 'Echo-4 Specialist',
      callsign: 'echo_four',
      avatar: '🛰️',
      status: 'idle',
      statusText: 'Analyzing deep space radio telemetry',
      staffRank: 1,
      roles: ['Recon Specialist', 'Orbital Sensor Tech'],
      bio: 'Telemetry data archivist and frequency alignment operator.',
      memberSince: '2024-08-01',
      quantumKeyFingerprint: 'SF-QKD-1102-EC44',
    },
    {
      id: 'u4',
      name: 'Nova Pilot',
      callsign: 'nova_star',
      avatar: '🛸',
      status: 'online',
      statusText: 'FTL Jump in progress...',
      roles: ['Vanguard Pilot'],
      bio: 'Long-range scout pilot traversing uncharted subspace corridors.',
      memberSince: '2025-02-18',
      quantumKeyFingerprint: 'SF-QKD-8831-NV11',
    },
  ];

  // Quick Scan (Ctrl+K) Hotkey
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsQuickScanOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        author: 'Command Officer (You)',
        callsign: 'cmdr_you',
        avatar: '⚡',
        content: messageInput,
        timestamp: 'Just now',
        staffRank: 2,
      },
    ]);
    setMessageInput('');
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const currentReactions = m.reactions || [];
        const existing = currentReactions.find((r) => r.emoji === emoji);
        if (existing) {
          return {
            ...m,
            reactions: currentReactions.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + 1 } : r
            ),
          };
        } else {
          return {
            ...m,
            reactions: [...currentReactions, { emoji, count: 1, users: ['You'] }],
          };
        }
      })
    );
    showToast(`Added reaction ${emoji}`);
  };

  const handleTogglePin = (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const newPinned = !m.isPinned;
        showToast(newPinned ? 'Pinned transmission to band' : 'Unpinned transmission');
        return { ...m, isPinned: newPinned };
      })
    );
  };

  const handleDeleteMessage = (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    showToast('Transmission deleted');
  };

  // Context Menu Builders
  const getBeaconContextMenu = (beacon: Beacon): ContextMenuItem[] => [
    {
      label: 'Mark As Read',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF88]" />,
      onClick: () => {
        setBeacons(prev => prev.map(b => b.id === beacon.id ? { ...b, unreadCount: 0 } : b));
        showToast(`Marked ${beacon.name} as read`);
      },
    },
    {
      label: 'Invite Transmitters',
      icon: <Users className="w-3.5 h-3.5 text-[#00F0FF]" />,
      onClick: () => showToast(`Invite link copied for ${beacon.name}`),
    },
    {
      label: 'Mute Beacon',
      icon: <Bell className="w-3.5 h-3.5 text-[#94A3B8]" />,
      children: [
        { label: 'For 15 Minutes', onClick: () => showToast(`Muted ${beacon.name} for 15m`) },
        { label: 'For 1 Hour', onClick: () => showToast(`Muted ${beacon.name} for 1h`) },
        { label: 'For 8 Hours', onClick: () => showToast(`Muted ${beacon.name} for 8h`) },
        { label: 'For 24 Hours', onClick: () => showToast(`Muted ${beacon.name} for 24h`) },
        { label: 'Until I turn it back on', onClick: () => showToast(`Muted ${beacon.name} indefinitely`) },
      ],
    },
    {
      label: 'Beacon Settings',
      icon: <Settings className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => setIsSettingsOpen(true),
    },
    {
      label: 'Copy Beacon ID',
      icon: <Copy className="w-3.5 h-3.5 text-[#94A3B8]" />,
      shortcut: 'Ctrl+C',
      onClick: () => {
        navigator.clipboard?.writeText(beacon.id);
        showToast(`Copied ${beacon.id}`);
      },
    },
    { separator: true },
    {
      label: 'Leave Beacon Network',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5 text-[#FF3366]" />,
      onClick: () => showToast(`Left ${beacon.name}`),
    },
  ];

  const getChannelContextMenu = (channel: Channel): ContextMenuItem[] => [
    {
      label: 'Mark As Read',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF88]" />,
      onClick: () => showToast(`Marked #${channel.name} as read`),
    },
    {
      label: 'Edit Frequency Band',
      icon: <Settings className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => showToast(`Editing channel #${channel.name}`),
    },
    {
      label: 'Mute Band',
      icon: <Bell className="w-3.5 h-3.5 text-[#94A3B8]" />,
      children: [
        { label: 'For 15 Minutes', onClick: () => showToast(`Muted #${channel.name} for 15m`) },
        { label: 'For 1 Hour', onClick: () => showToast(`Muted #${channel.name} for 1h`) },
        { label: 'Until I turn it back on', onClick: () => showToast(`Muted #${channel.name} indefinitely`) },
      ],
    },
    {
      label: 'Copy Band ID',
      icon: <Copy className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => {
        navigator.clipboard?.writeText(channel.id);
        showToast(`Copied #${channel.id}`);
      },
    },
    { separator: true },
    {
      label: 'Delete Frequency Band',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5 text-[#FF3366]" />,
      onClick: () => {
        setChannels(prev => prev.filter(c => c.id !== channel.id));
        showToast(`Deleted #${channel.name}`);
      },
    },
  ];

  const getMessageContextMenu = (message: Message): ContextMenuItem[] => [
    {
      label: 'Add Reaction',
      icon: <Sparkles className="w-3.5 h-3.5 text-[#00F0FF]" />,
      children: [
        { label: '👍 Thumbs Up', onClick: () => handleAddReaction(message.id, '👍') },
        { label: '🚀 Ascent', onClick: () => handleAddReaction(message.id, '🚀') },
        { label: '⚡ Subspace Pulse', onClick: () => handleAddReaction(message.id, '⚡') },
        { label: '❤️ Heart Resonance', onClick: () => handleAddReaction(message.id, '❤️') },
        { label: '🛸 Unidentified Object', onClick: () => handleAddReaction(message.id, '🛸') },
      ],
    },
    {
      label: 'Reply to Transmission',
      icon: <MessageSquare className="w-3.5 h-3.5 text-[#00F0FF]" />,
      onClick: () => setMessageInput(`> ${message.content}\n@${message.author} `),
    },
    {
      label: message.isPinned ? 'Unpin Transmission' : 'Pin Transmission',
      icon: <Pin className="w-3.5 h-3.5 text-[#00F0FF]" />,
      onClick: () => handleTogglePin(message.id),
    },
    {
      label: 'Copy Transmission Content',
      icon: <Copy className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => {
        navigator.clipboard?.writeText(message.content);
        showToast('Transmission text copied');
      },
    },
    { separator: true },
    {
      label: 'Delete Transmission',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5 text-[#FF3366]" />,
      onClick: () => handleDeleteMessage(message.id),
    },
  ];

  const getUserContextMenu = (user: UserProfile): ContextMenuItem[] => [
    {
      label: 'View Tactical Dossier',
      icon: <Shield className="w-3.5 h-3.5 text-[#00F0FF]" />,
      onClick: () => setSelectedUserProfile(user),
    },
    {
      label: 'Direct Quantum Transmission',
      icon: <MessageSquare className="w-3.5 h-3.5 text-[#00F0FF]" />,
      onClick: () => showToast(`Opening direct channel to ${user.name}`),
    },
    {
      label: 'Mute Transmitter',
      icon: <Bell className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => showToast(`Muted @${user.callsign}`),
    },
    {
      label: 'Copy Subspace ID',
      icon: <Copy className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => {
        navigator.clipboard?.writeText(user.id);
        showToast(`Copied ID for @${user.callsign}`);
      },
    },
    { separator: true },
    {
      label: 'Report Rogue Frequency',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5 text-[#FF3366]" />,
      onClick: () => showToast(`Reported @${user.callsign} to High Command`),
    },
  ];

  const handleAttachmentMenu = (e: React.MouseEvent) => {
    openContextMenu(e, [
      {
        label: 'Upload File (Vault Presigned Gate)',
        icon: <Paperclip className="w-3.5 h-3.5 text-[#00F0FF]" />,
        onClick: () => showToast('Vault S3 upload gate triggered'),
      },
      {
        label: 'Create Archival Flight Thread',
        icon: <Archive className="w-3.5 h-3.5 text-[#7928CA]" />,
        onClick: () => showToast('Opened Archival Thread builder'),
      },
      {
        label: 'Quantum Key Handshake (E2EE)',
        icon: <Key className="w-3.5 h-3.5 text-[#00FF88]" />,
        onClick: () => showToast('Initiating Double Ratchet key rotation'),
      },
    ]);
  };

  const getChannelIcon = (type: Channel['type']) => {
    switch (type) {
      case 'COMM_LINK': return <Volume2 className="w-4 h-4 text-[#00F0FF]" />;
      case 'ARCHIVAL_RELAY': return <Archive className="w-4 h-4 text-[#7928CA]" />;
      case 'VISUAL_RELAY': return <ImageIcon className="w-4 h-4 text-[#FFB800]" />;
      case 'TEXT_RELAY':
      default:
        return <Hash className="w-4 h-4 text-[#94A3B8]" />;
    }
  };

  const currentFontFamily = THEME.fonts.find(f => f.id === selectedFont)?.family || 'inherit';

  return (
    <div 
      className="flex h-screen w-screen bg-[#07090E] text-[#F0F4F8] select-none overflow-hidden"
      style={{ fontFamily: currentFontFamily }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-[99999] bg-[#0E1118] border border-[#00F0FF]/40 text-[#F0F4F8] px-4 py-2.5 rounded-xl shadow-[0_10px_30px_rgba(0,240,255,0.2)] text-xs font-mono flex items-center gap-2 animate-in slide-in-from-top-2">
          <span className="w-2 h-2 rounded-full bg-[#00F0FF] animate-ping" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Beacon Strip (Far Left) */}
      <div className="w-[72px] bg-[#07090E] flex flex-col items-center py-3 gap-2 border-r border-[#232936] shrink-0 z-20">
        <button
          onClick={() => setSelectedBeaconId('home')}
          onContextMenu={(e) => {
            openContextMenu(e, [
              { label: 'Subspace Gateway', icon: <Radio className="w-3.5 h-3.5 text-[#00F0FF]" />, onClick: () => setSelectedBeaconId('home') },
              { label: 'Direct Transmissions', icon: <MessageSquare className="w-3.5 h-3.5 text-[#00F0FF]" />, onClick: () => showToast('Direct transmissions active') },
              { separator: true },
              { label: 'Interface Settings', icon: <Settings className="w-3.5 h-3.5 text-[#94A3B8]" />, onClick: () => setIsSettingsOpen(true) },
            ]);
          }}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 group relative ${
            selectedBeaconId === 'home' ? 'bg-[#00F0FF] text-[#07090E]' : 'bg-[#151922] text-[#00F0FF] hover:bg-[#00F0FF]/20'
          }`}
          title="Subspace Gateway"
        >
          <Radio className="w-6 h-6" />
          <span className="absolute left-full ml-3 px-2 py-1 bg-[#151922] border border-[#232936] text-xs rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
            Direct Transmissions
          </span>
        </button>

        <div className="w-8 h-[2px] bg-[#232936] rounded-full my-1" />

        {/* Cluster / Beacons List */}
        <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto overflow-x-hidden">
          {/* Cluster Folder */}
          {clusters.map((cluster) => {
            const isExpanded = expandedClusters[cluster.id];
            return (
              <div key={cluster.id} className="flex flex-col items-center gap-1 w-full">
                <button
                  onClick={() => setExpandedClusters(p => ({ ...p, [cluster.id]: !p[cluster.id] }))}
                  onContextMenu={(e) => {
                    openContextMenu(e, [
                      { label: `Cluster: ${cluster.name}`, disabled: true },
                      { separator: true },
                      { label: isExpanded ? 'Collapse Cluster' : 'Expand Cluster', onClick: () => setExpandedClusters(p => ({ ...p, [cluster.id]: !p[cluster.id] })) },
                      { label: 'Cluster Settings', icon: <Settings className="w-3.5 h-3.5 text-[#94A3B8]" />, onClick: () => showToast(`Settings for ${cluster.name}`) },
                      { separator: true },
                      { label: 'Disband Cluster', danger: true, icon: <Trash2 className="w-3.5 h-3.5 text-[#FF3366]" />, onClick: () => showToast(`Disbanded ${cluster.name}`) },
                    ]);
                  }}
                  className="w-12 h-10 rounded-xl bg-[#151922]/70 hover:bg-[#1C222E] flex items-center justify-center text-[#94A3B8] transition-all"
                  title={`Cluster: ${cluster.name}`}
                >
                  {isExpanded ? <FolderOpen className="w-5 h-5 text-[#00F0FF]" /> : <Folder className="w-5 h-5" />}
                </button>
                {isExpanded && cluster.beaconIds.map((bId) => {
                  const beacon = beacons.find(b => b.id === bId);
                  if (!beacon) return null;
                  const isSelected = selectedBeaconId === beacon.id;
                  return (
                    <button
                      key={beacon.id}
                      onClick={() => setSelectedBeaconId(beacon.id)}
                      onContextMenu={(e) => openContextMenu(e, getBeaconContextMenu(beacon))}
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm transition-all duration-200 relative group ${
                        isSelected 
                          ? 'bg-[#00F0FF] text-[#07090E] rounded-xl shadow-[0_0_15px_rgba(0,240,255,0.4)]' 
                          : 'bg-[#151922] text-[#94A3B8] hover:text-[#F0F4F8] hover:rounded-xl hover:bg-[#1C222E]'
                      }`}
                    >
                      {beacon.name.substring(0, 2).toUpperCase()}
                      {beacon.unreadCount && beacon.unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-[#FF3366] text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-mono border-2 border-[#07090E]">
                          {beacon.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Standalone Beacon */}
          {beacons.filter(b => !clusters.some(c => c.beaconIds.includes(b.id))).map((beacon) => {
            const isSelected = selectedBeaconId === beacon.id;
            return (
              <button
                key={beacon.id}
                onClick={() => setSelectedBeaconId(beacon.id)}
                onContextMenu={(e) => openContextMenu(e, getBeaconContextMenu(beacon))}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm transition-all duration-200 relative ${
                  isSelected 
                    ? 'bg-[#00F0FF] text-[#07090E] rounded-xl shadow-[0_0_15px_rgba(0,240,255,0.4)]' 
                    : 'bg-[#151922] text-[#94A3B8] hover:text-[#F0F4F8] hover:rounded-xl hover:bg-[#1C222E]'
                }`}
              >
                {beacon.name.substring(0, 2).toUpperCase()}
              </button>
            );
          })}
        </div>

        {/* Discovery & Settings */}
        <div className="flex flex-col items-center gap-2 pt-2 border-t border-[#232936]">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="w-12 h-12 rounded-2xl bg-[#151922] hover:bg-[#1C222E] flex items-center justify-center text-[#94A3B8] hover:text-[#00F0FF] transition-all"
            title="Interface & Quantum Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 2. Channels / Frequency Bands Sidebar */}
      <div className="w-60 bg-[#0B0E14] flex flex-col border-r border-[#232936] shrink-0">
        {/* Beacon Header */}
        <div 
          className="h-14 px-4 border-b border-[#232936] flex items-center justify-between font-semibold tracking-wide text-[#F0F4F8] cursor-pointer hover:bg-[#151922]/50 transition-colors"
          onClick={(e) => {
            const currentBeacon = beacons.find(b => b.id === selectedBeaconId) || beacons[0];
            openContextMenu(e, getBeaconContextMenu(currentBeacon));
          }}
          onContextMenu={(e) => {
            const currentBeacon = beacons.find(b => b.id === selectedBeaconId) || beacons[0];
            openContextMenu(e, getBeaconContextMenu(currentBeacon));
          }}
        >
          <span className="truncate">
            {beacons.find(b => b.id === selectedBeaconId)?.name || 'Aegis Command Station'}
          </span>
          <span className="w-2 h-2 rounded-full bg-[#00FF88] shadow-[0_0_8px_#00FF88]" title="Beacon Online" />
        </div>

        {/* Channels List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] px-2 py-1 flex items-center justify-between">
            <span>Frequency Bands</span>
            <Activity className="w-3 h-3 text-[#00F0FF]" />
          </div>

          {channels.map((chan) => {
            const isSelected = selectedChannelId === chan.id;
            return (
              <button
                key={chan.id}
                onClick={() => {
                  setSelectedChannelId(chan.id);
                  if (chan.type === 'COMM_LINK') {
                    setInVoiceRoom(true);
                  }
                }}
                onContextMenu={(e) => openContextMenu(e, getChannelContextMenu(chan))}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  isSelected
                    ? 'bg-[#151922] text-[#00F0FF] border border-[#00F0FF]/30 shadow-sm'
                    : 'text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#151922]/60'
                }`}
              >
                {getChannelIcon(chan.type)}
                <span className="truncate">{chan.name}</span>
              </button>
            );
          })}
        </div>

        {/* User Identity / Audio Controls Footer */}
        <div className="p-3 bg-[#07090E] border-t border-[#232936] flex items-center justify-between">
          <div 
            className="flex items-center gap-2.5 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setSelectedUserProfile(members[1])}
            onContextMenu={(e) => openContextMenu(e, getUserContextMenu(members[1]))}
          >
            <div className="w-8 h-8 rounded-lg bg-[#151922] border border-[#232936] flex items-center justify-center text-sm font-bold text-[#00F0FF]">
              ⚡
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#F0F4F8] truncate flex items-center gap-1">
                Cmdr Vance
                <Shield className="w-3 h-3 text-[#00F0FF]" />
              </div>
              <div className="text-[10px] text-[#00FF88] font-mono">Ghost Mode (Incognito)</div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[#94A3B8]">
            <button
              onClick={() => setIsMuted(p => !p)}
              className={`p-1.5 rounded-lg hover:bg-[#151922] transition-colors ${isMuted ? 'text-[#FF3366]' : 'hover:text-[#F0F4F8]'}`}
              title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setIsDeafened(p => !p)}
              className={`p-1.5 rounded-lg hover:bg-[#151922] transition-colors ${isDeafened ? 'text-[#FF3366]' : 'hover:text-[#F0F4F8]'}`}
              title={isDeafened ? 'Undeafen Audio' : 'Deafen Audio'}
            >
              <Headphones className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Chat Viewport & Relay Feed */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#07090E]">
        {/* Top Header */}
        <div className="h-14 px-6 border-b border-[#232936] flex items-center justify-between shrink-0 bg-[#0B0E14]/40 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <Hash className="w-5 h-5 text-[#00F0FF]" />
            <div className="font-semibold text-[#F0F4F8] tracking-wide text-sm truncate">
              {channels.find(c => c.id === selectedChannelId)?.name || 'transmission-relay'}
            </div>
            <span className="text-xs text-[#64748B] hidden md:inline border-l border-[#232936] pl-3">
              Direct Quantum Encryption Active (Double Ratchet Subspace)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Scan Trigger */}
            <button
              onClick={() => setIsQuickScanOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#151922] border border-[#232936] text-xs text-[#94A3B8] hover:text-[#F0F4F8] hover:border-[#00F0FF]/40 transition-all"
            >
              <Search className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span className="hidden sm:inline">Quick Scan</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#0B0E14] text-[10px] font-mono border border-[#232936]">
                Ctrl+K
              </kbd>
            </button>

            {/* Pinned Messages Button */}
            <button
              onClick={() => setIsPinnedDrawerOpen(p => !p)}
              className={`p-2 rounded-xl border transition-all ${
                isPinnedDrawerOpen 
                  ? 'bg-[#00F0FF]/20 border-[#00F0FF] text-[#00F0FF]' 
                  : 'bg-[#151922] border-[#232936] text-[#94A3B8] hover:text-[#F0F4F8]'
              }`}
              title="Pinned Transmissions"
            >
              <Pin className="w-4 h-4" />
            </button>

            {/* Members Panel Toggle */}
            <button
              onClick={() => setIsMemberPanelOpen(p => !p)}
              className={`p-2 rounded-xl border transition-all ${
                isMemberPanelOpen 
                  ? 'bg-[#00F0FF]/20 border-[#00F0FF] text-[#00F0FF]' 
                  : 'bg-[#151922] border-[#232936] text-[#94A3B8] hover:text-[#F0F4F8]'
              }`}
              title="Transmitters Dossier List"
            >
              <Users className="w-4 h-4" />
            </button>

            {/* Platform indicator badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151922] border border-[#232936] text-[11px] font-mono ml-1">
              <span className="w-2 h-2 rounded-full bg-[#00F0FF]" />
              <span className="uppercase text-[#94A3B8]">{platform.platformName}</span>
            </div>
          </div>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {inVoiceRoom && (
            <div className="p-4 rounded-2xl bg-[#151922]/80 border border-[#00F0FF]/30 mb-4 shadow-[0_0_20px_rgba(0,240,255,0.1)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/20 flex items-center justify-center text-[#00F0FF]">
                  <Volume2 className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[#F0F4F8]">Bridge Comm-Link [Alpha] Connected</h4>
                  <p className="text-xs text-[#94A3B8]">LiveKit RTC Subchannel • 128 kbps Quantum Opus</p>
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={() => setInVoiceRoom(false)}>
                Disconnect Link
              </Button>
            </div>
          )}

          {messages.map((m) => {
            const authorMember = members.find(mem => mem.name === m.author) || {
              id: `user-${m.author}`,
              name: m.author,
              callsign: m.callsign || 'transmitter',
              avatar: m.avatar,
              status: 'online' as const,
              staffRank: m.staffRank,
            };

            return (
              <div 
                key={m.id} 
                onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                className="flex items-start gap-4 group hover:bg-[#151922]/40 -mx-4 px-4 py-2.5 rounded-2xl transition-colors relative"
              >
                {/* Floating Message Action Bar on Hover */}
                <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <MessageActionBar
                    onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                    onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                    onPin={() => handleTogglePin(m.id)}
                    onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                  />
                </div>

                {/* Avatar with click for profile popout */}
                <div 
                  onClick={() => setSelectedUserProfile(authorMember)}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    openContextMenu(e, getUserContextMenu(authorMember));
                  }}
                  className="w-10 h-10 rounded-xl bg-[#151922] border border-[#232936] flex items-center justify-center text-lg shrink-0 cursor-pointer hover:scale-105 transition-transform"
                >
                  {m.avatar}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span 
                      onClick={() => setSelectedUserProfile(authorMember)}
                      className="text-sm font-semibold text-[#F0F4F8] cursor-pointer hover:underline"
                    >
                      {m.author}
                    </span>
                    {m.staffRank && m.staffRank > 0 && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#00F0FF]/20 text-[#00F0FF] font-bold flex items-center gap-1">
                        <Shield className="w-2.5 h-2.5" />
                        {m.staffRank === 3 ? 'Root Staff' : m.staffRank === 2 ? 'Admin' : 'Moderator'}
                      </span>
                    )}
                    <span className="text-xs text-[#64748B]">{m.timestamp}</span>
                    {m.isPinned && (
                      <span className="text-[10px] text-[#00F0FF] font-mono flex items-center gap-0.5 ml-1">
                        <Pin className="w-2.5 h-2.5" /> Pinned
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-[#E2E8F0] leading-relaxed break-words">
                    {m.content}
                  </div>

                  {/* Reactions Chips */}
                  {m.reactions && m.reactions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.reactions.map((r, rIdx) => (
                        <button
                          key={rIdx}
                          onClick={() => handleAddReaction(m.id, r.emoji)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#151922] border border-[#232936] hover:border-[#00F0FF]/40 text-xs text-[#94A3B8] transition-all"
                        >
                          <span>{r.emoji}</span>
                          <span className="font-mono text-[11px] text-[#F0F4F8]">{r.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Message Input Bar */}
        <form onSubmit={handleSendMessage} className="p-4 bg-[#07090E] border-t border-[#232936]">
          <div className="flex items-center gap-2 bg-[#151922] border border-[#232936] rounded-2xl px-4 py-2.5 focus-within:border-[#00F0FF] focus-within:shadow-[0_0_20px_rgba(0,240,255,0.15)] transition-all">
            <button
              type="button"
              onClick={handleAttachmentMenu}
              className="p-1.5 text-[#94A3B8] hover:text-[#00F0FF] transition-colors"
              title="Add Quantum Attachment or Broadcast"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Send transmission to #quantum-transmissions (2,000 char limit)..."
              maxLength={2000}
              className="flex-1 bg-transparent text-[#F0F4F8] placeholder-[#64748B] text-sm outline-none"
            />
            <Button type="submit" variant="primary" size="sm" className="rounded-xl">
              <Send className="w-4 h-4 mr-1" /> Transmit
            </Button>
          </div>
        </form>
      </div>

      {/* 4. Transmitters / Member Dossier Sidebar (Far Right) */}
      {isMemberPanelOpen && (
        <div className="w-60 bg-[#0B0E14] border-l border-[#232936] flex flex-col shrink-0">
          <div className="h-14 px-4 border-b border-[#232936] flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#64748B]">
            <span>Active Transmitters</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#151922] text-[#00F0FF]">
              {members.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Command Staff Section */}
            <div>
              <div className="text-[11px] font-semibold uppercase text-[#64748B] px-2 mb-2 tracking-wider">
                Fleet Command — {members.filter(m => m.staffRank && m.staffRank >= 2).length}
              </div>
              <div className="space-y-1">
                {members.filter(m => m.staffRank && m.staffRank >= 2).map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setSelectedUserProfile(m)}
                    onContextMenu={(e) => openContextMenu(e, getUserContextMenu(m))}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-[#151922] cursor-pointer transition-colors group"
                  >
                    <div className="relative">
                      <div className="w-8 h-8 rounded-lg bg-[#151922] border border-[#232936] flex items-center justify-center text-sm">
                        {m.avatar}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#00FF88] border-2 border-[#0B0E14]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#F0F4F8] truncate flex items-center gap-1 group-hover:text-[#00F0FF]">
                        {m.name}
                        <Shield className="w-2.5 h-2.5 text-[#00F0FF]" />
                      </div>
                      <div className="text-[10px] text-[#64748B] truncate">
                        {m.statusText || `@${m.callsign}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Enlisted Crew Section */}
            <div>
              <div className="text-[11px] font-semibold uppercase text-[#64748B] px-2 mb-2 tracking-wider">
                Enlisted Transmitters — {members.filter(m => !m.staffRank || m.staffRank < 2).length}
              </div>
              <div className="space-y-1">
                {members.filter(m => !m.staffRank || m.staffRank < 2).map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setSelectedUserProfile(m)}
                    onContextMenu={(e) => openContextMenu(e, getUserContextMenu(m))}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-[#151922] cursor-pointer transition-colors group"
                  >
                    <div className="relative">
                      <div className="w-8 h-8 rounded-lg bg-[#151922] border border-[#232936] flex items-center justify-center text-sm">
                        {m.avatar}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0B0E14] ${
                        m.status === 'online' ? 'bg-[#00FF88]' : m.status === 'idle' ? 'bg-[#FFB800]' : 'bg-[#64748B]'
                      }`} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#F0F4F8] truncate group-hover:text-[#00F0FF]">
                        {m.name}
                      </div>
                      <div className="text-[10px] text-[#64748B] truncate">
                        {m.statusText || `@${m.callsign}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Pinned Transmissions Flyout Drawer */}
      {isPinnedDrawerOpen && (
        <div className="w-80 bg-[#0B0E14] border-l border-[#232936] flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
          <div className="h-14 px-4 border-b border-[#232936] flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#F0F4F8]">
              <Pin className="w-4 h-4 text-[#00F0FF]" />
              <span>Pinned Transmissions</span>
            </div>
            <button 
              onClick={() => setIsPinnedDrawerOpen(false)}
              className="p-1 rounded-lg text-[#64748B] hover:text-[#F0F4F8] hover:bg-[#151922]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.filter(m => m.isPinned).length === 0 ? (
              <div className="text-xs text-[#64748B] text-center mt-8">
                No transmissions pinned to this frequency band yet.
              </div>
            ) : (
              messages.filter(m => m.isPinned).map(m => (
                <div 
                  key={`pin-${m.id}`}
                  onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                  className="p-3 rounded-xl bg-[#151922] border border-[#232936] space-y-2 hover:border-[#00F0FF]/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#F0F4F8]">{m.author}</span>
                    <span className="text-[10px] text-[#64748B]">{m.timestamp}</span>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">{m.content}</p>
                  <div className="flex justify-end gap-2 pt-1 border-t border-[#232936]/60">
                    <button
                      onClick={() => handleTogglePin(m.id)}
                      className="text-[10px] text-[#FF3366] hover:underline"
                    >
                      Unpin
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* User Tactical Dossier Modal Popout */}
      <Modal
        isOpen={Boolean(selectedUserProfile)}
        onClose={() => setSelectedUserProfile(null)}
        title="Tactical Transmitter Dossier"
        maxWidth="md"
      >
        {selectedUserProfile && (
          <div className="flex justify-center py-2">
            <ProfileCard
              user={selectedUserProfile}
              onSendMessage={(uid) => {
                setSelectedUserProfile(null);
                showToast(`Opened direct transmission with ${uid}`);
              }}
              onClose={() => setSelectedUserProfile(null)}
            />
          </div>
        )}
      </Modal>

      {/* Quick Scan Modal (Ctrl+K) */}
      <Modal
        isOpen={isQuickScanOpen}
        onClose={() => setIsQuickScanOpen(false)}
        title="Subspace Quick Scan"
        description="Search transmissions, frequency bands, archival forum logs, or jump directly."
        maxWidth="lg"
      >
        <div className="flex flex-col gap-4">
          <Input
            autoFocus
            icon={<Search className="w-4 h-4" />}
            placeholder="Search keywords, #channels, or @operators..."
            value={quickScanQuery}
            onChange={(e) => setQuickScanQuery(e.target.value)}
          />

          <div className="space-y-2 mt-2">
            <div className="text-[11px] font-semibold uppercase text-[#64748B]">Recent Frequency Bands</div>
            {channels.map((chan) => (
              <div
                key={chan.id}
                onClick={() => {
                  setSelectedChannelId(chan.id);
                  setIsQuickScanOpen(false);
                }}
                className="flex items-center justify-between p-2.5 rounded-xl bg-[#0B0E14] hover:bg-[#1C222E] border border-[#232936] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  {getChannelIcon(chan.type)}
                  <span className="text-sm font-medium text-[#F0F4F8]">{chan.name}</span>
                </div>
                <span className="text-xs text-[#64748B] font-mono">JUMP</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Settings & Customization Modal */}
      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="Subspace Tactical Customizer"
        description="Configure your quantum visual spectrum, typography, and commendation showcase."
        maxWidth="xl"
      >
        <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-2">
          {/* Color Accent Picker */}
          <ColorWheel
            color={accentColor}
            onChange={setAccentColor}
          />

          {/* Typography Selector */}
          <FontSelector
            selectedFont={selectedFont}
            onChange={setSelectedFont}
          />

          {/* Badge Deck */}
          <BadgeDeck
            userStaffRank={2}
            badges={[
              { id: 'b1', name: 'Quantum Pioneer', description: 'Participated in the initial subspace handshake.', tier: 'quantum' },
              { id: 'b2', name: 'Command Staff Insignia', description: 'Authorized officer on tactical command networks.', tier: 'staff', isStaffLocked: true },
              { id: 'b3', name: 'Deep Space Archivist', description: 'Maintained 50+ archival forum flight threads.', tier: 'gold' },
              { id: 'b4', name: 'Signal Vanguard', description: 'Zero signal dropouts in orbital operations.', tier: 'silver' },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
};

// Top-level App with ContextMenuProvider
export const App: React.FC = () => {
  // Global canvas fallback context menu (displayed when right-clicking empty space anywhere in the app)
  const canvasFallbackItems: ContextMenuItem[] = [
    {
      label: 'Subspace Frequency Terminal',
      disabled: true,
    },
    { separator: true },
    {
      label: 'Subspace Quick Scan',
      shortcut: 'Ctrl+K',
      icon: <Search className="w-3.5 h-3.5 text-[#00F0FF]" />,
      onClick: () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      },
    },
    {
      label: 'Subspace Diagnostics',
      icon: <Activity className="w-3.5 h-3.5 text-[#00FF88]" />,
      onClick: () => {
        navigator.clipboard?.writeText(JSON.stringify({
          status: 'NOMINAL',
          latency: '12ms',
          quantumEntanglement: 'ACTIVE',
          clientVersion: '1.0.0-tactical'
        }, null, 2));
        alert('Quantum diagnostics telemetry copied to clipboard.');
      },
    },
    {
      label: 'Reload Frequency Array',
      shortcut: 'F5',
      icon: <Radio className="w-3.5 h-3.5 text-[#94A3B8]" />,
      onClick: () => window.location.reload(),
    },
    { separator: true },
    {
      label: 'Subspace Protocol v1.0.0 (Tactical Edition)',
      disabled: true,
    },
  ];

  return (
    <ContextMenuProvider fallbackItems={canvasFallbackItems}>
      <AppContent />
    </ContextMenuProvider>
  );
};
