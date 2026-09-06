import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Hash, 
  Volume2, 
  Search, 
  Settings, 
  Shield, 
  Send, 
  Plus, 
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
  Key,
  ChevronDown,
  ChevronRight,
  Smile,
  Compass,
  Gift,
  HelpCircle,
  PhoneOff,
  Monitor,
  Video
} from 'lucide-react';
import { 
  Modal, 
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

// Data Interfaces
interface Beacon {
  id: string;
  name: string;
  unreadCount?: number;
  iconText: string;
  gradient: string;
}

interface ChannelCategory {
  id: string;
  name: string;
  collapsed?: boolean;
  channels: Channel[];
}

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'archive' | 'gallery';
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
  roleColor?: string;
  staffRank?: number;
  roleBadge?: string;
  isPinned?: boolean;
  reactions?: MessageReaction[];
}

export const AppContent: React.FC = () => {
  const platform = usePlatformEnvironment();
  const { openContextMenu } = useContextMenu();

  // Navigation & Active Selections
  const [selectedBeaconId, setSelectedBeaconId] = useState('beacon-aegis');
  const [selectedChannelId, setSelectedChannelId] = useState('chan-quantum');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Modals & Panels
  const [isQuickScanOpen, setIsQuickScanOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemberPanelOpen, setIsMemberPanelOpen] = useState(true);
  const [isPinnedDrawerOpen, setIsPinnedDrawerOpen] = useState(false);
  const [isUserPopoutOpen, setIsUserPopoutOpen] = useState(false);
  const [inspectedUser, setInspectedUser] = useState<UserProfile | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'profile' | 'appearance' | 'voice' | 'badges'>('appearance');

  // Audio / RTC Comm-Link State
  const [inVoiceRoom, setInVoiceRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  // Settings State
  const [accentColor, setAccentColor] = useState('#00F0FF');
  const [selectedFont, setSelectedFont] = useState('default');
  const [messageInput, setMessageInput] = useState('');
  const [quickScanQuery, setQuickScanQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // User Self Identity
  const [currentUser, setCurrentUser] = useState<UserProfile>({
    id: 'u-self',
    name: 'Command Officer (You)',
    callsign: 'cmdr_you',
    avatar: '⚡',
    status: 'online',
    statusText: 'Quantum double-ratchet synchronized',
    staffRank: 2,
    roles: ['Command Staff', 'Sysop', 'Level 4 Clearance'],
    bio: 'Chief Tactical Communications Officer aboard Aegis Command Station.',
    memberSince: 'Jan 15, 2023',
    quantumKeyFingerprint: 'SF-QKD-4412-BB09',
    isSelf: true,
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Beacons / Servers List
  const [beacons, setBeacons] = useState<Beacon[]>([
    { id: 'beacon-aegis', name: 'Aegis Command Station', unreadCount: 3, iconText: 'AC', gradient: 'linear-gradient(135deg, #00f0ff, #5865f2)' },
    { id: 'beacon-vanguard', name: 'Vanguard Squadron', iconText: 'VS', gradient: 'linear-gradient(135deg, #7928ca, #ff0080)' },
    { id: 'beacon-rim', name: 'Outer Rim Coalition', iconText: 'OR', gradient: 'linear-gradient(135deg, #23a55a, #00f0ff)' },
    { id: 'beacon-sol', name: 'Solaris Research Facility', iconText: 'SR', gradient: 'linear-gradient(135deg, #f0b232, #f23f43)' },
  ]);

  // Channel Categories
  const categories: ChannelCategory[] = [
    {
      id: 'cat-priority',
      name: 'Priority Broadcasts',
      channels: [
        { id: 'chan-announcements', name: 'orbital-bulletins', type: 'announcement' },
        { id: 'chan-rules', name: 'protocol-directives', type: 'text' },
      ],
    },
    {
      id: 'cat-relays',
      name: 'Transmission Relays',
      channels: [
        { id: 'chan-quantum', name: 'quantum-transmissions', type: 'text' },
        { id: 'chan-recon', name: 'telemetry-recon-gallery', type: 'gallery' },
        { id: 'chan-archives', name: 'flight-logs-archive', type: 'archive' },
      ],
    },
    {
      id: 'cat-comms',
      name: 'Voice Comm-Links',
      channels: [
        { id: 'chan-bridge', name: 'Bridge Comm-Link [Alpha]', type: 'voice' },
        { id: 'chan-squadron', name: 'Squadron Tactical [LiveKit]', type: 'voice' },
      ],
    },
  ];

  // Active Messages
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      author: 'Fleet Admiral Vance',
      callsign: 'adm_vance',
      avatar: '👨‍🚀',
      content: 'All subspace arrays report nominal frequency resonance across orbital sector 7. Key ratchet exchange complete.',
      timestamp: 'Today at 2:22 PM',
      roleColor: '#00f0ff',
      staffRank: 3,
      roleBadge: 'ROOT STAFF',
      isPinned: true,
      reactions: [
        { emoji: '⚡', count: 4, users: ['Echo-4', 'Nova'] },
        { emoji: '👍', count: 2, users: ['You'] },
      ],
    },
    {
      id: 'm2',
      author: 'Echo-4 Specialist',
      callsign: 'echo_four',
      avatar: '🛰️',
      content: 'Acknowledged Admiral. Telemetry synchronized with quantum bitfield. Vault S3 presigned gateway active.',
      timestamp: 'Today at 2:25 PM',
      roleColor: '#23a55a',
      staffRank: 1,
      roleBadge: 'MODERATOR',
      reactions: [{ emoji: '🚀', count: 3, users: ['Vance'] }],
    },
  ]);

  // Transmitters / Members
  const members: UserProfile[] = [
    {
      id: 'u1',
      name: 'Fleet Admiral Vance',
      callsign: 'adm_vance',
      avatar: '👨‍🚀',
      status: 'online',
      statusText: 'Directing orbital fleet arrays',
      staffRank: 3,
      roles: ['High Command', 'Fleet Admiral', 'Quantum L5'],
      bio: 'Commander of Allied Subspace Expeditions since cycle 2021.',
      memberSince: 'Oct 18, 2021',
      quantumKeyFingerprint: 'SF-QKD-9981-FA23',
    },
    currentUser,
    {
      id: 'u3',
      name: 'Echo-4 Specialist',
      callsign: 'echo_four',
      avatar: '🛰️',
      status: 'idle',
      statusText: 'Listening to radio telemetry',
      staffRank: 1,
      roles: ['Recon Specialist', 'Sensor Tech'],
      bio: 'Deep space telemetry archivist.',
      memberSince: 'Aug 01, 2024',
      quantumKeyFingerprint: 'SF-QKD-1102-EC44',
    },
    {
      id: 'u4',
      name: 'Nova Pilot',
      callsign: 'nova_star',
      avatar: '🛸',
      status: 'online',
      statusText: 'FTL Jump in progress...',
      roles: ['Vanguard Scout'],
      bio: 'Reconnaissance flyer charting subspace wormholes.',
      memberSince: 'Feb 18, 2025',
      quantumKeyFingerprint: 'SF-QKD-8831-NV11',
    },
  ];

  // Quick Scan (Ctrl+K) Hotkey
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsQuickScanOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsUserPopoutOpen(false);
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    setMessages(prev => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        author: currentUser.name,
        callsign: currentUser.callsign,
        avatar: currentUser.avatar,
        content: messageInput,
        timestamp: 'Today at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        roleColor: '#00f0ff',
        staffRank: currentUser.staffRank,
        roleBadge: 'COMMAND STAFF',
      },
    ]);
    setMessageInput('');
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    setMessages(prev =>
      prev.map(m => {
        if (m.id !== messageId) return m;
        const cur = m.reactions || [];
        const existing = cur.find(r => r.emoji === emoji);
        if (existing) {
          return {
            ...m,
            reactions: cur.map(r => r.emoji === emoji ? { ...r, count: r.count + 1 } : r),
          };
        } else {
          return {
            ...m,
            reactions: [...cur, { emoji, count: 1, users: ['You'] }],
          };
        }
      })
    );
    showToast(`Reacted with ${emoji}`);
  };

  const handleTogglePin = (messageId: string) => {
    setMessages(prev =>
      prev.map(m => {
        if (m.id !== messageId) return m;
        const newPinned = !m.isPinned;
        showToast(newPinned ? 'Pinned transmission' : 'Unpinned transmission');
        return { ...m, isPinned: newPinned };
      })
    );
  };

  const handleDeleteMessage = (messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
    showToast('Transmission deleted');
  };

  // Context Menus
  const getBeaconContextMenu = (beacon: Beacon): ContextMenuItem[] => [
    {
      label: 'Mark As Read',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-[#23a55a]" />,
      onClick: () => {
        setBeacons(prev => prev.map(b => b.id === beacon.id ? { ...b, unreadCount: 0 } : b));
        showToast(`Marked ${beacon.name} as read`);
      },
    },
    {
      label: 'Invite People',
      icon: <Users className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Invite link copied for ${beacon.name}`),
    },
    {
      label: 'Mute Server',
      icon: <Bell className="w-3.5 h-3.5" />,
      children: [
        { label: 'For 15 Minutes', onClick: () => showToast(`Muted for 15m`) },
        { label: 'For 1 Hour', onClick: () => showToast(`Muted for 1h`) },
        { label: 'For 8 Hours', onClick: () => showToast(`Muted for 8h`) },
        { label: 'For 24 Hours', onClick: () => showToast(`Muted for 24h`) },
        { label: 'Until I turn it back on', onClick: () => showToast(`Muted indefinitely`) },
      ],
    },
    {
      label: 'Server Settings',
      icon: <Settings className="w-3.5 h-3.5" />,
      onClick: () => setIsSettingsOpen(true),
    },
    {
      label: 'Copy Server ID',
      icon: <Copy className="w-3.5 h-3.5" />,
      shortcut: 'Ctrl+C',
      onClick: () => {
        navigator.clipboard?.writeText(beacon.id);
        showToast(`Copied ${beacon.id}`);
      },
    },
    { separator: true },
    {
      label: 'Leave Server',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Left ${beacon.name}`),
    },
  ];

  const getChannelContextMenu = (channel: Channel): ContextMenuItem[] => [
    {
      label: 'Mark As Read',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-[#23a55a]" />,
      onClick: () => showToast(`Marked #${channel.name} as read`),
    },
    {
      label: 'Edit Channel',
      icon: <Settings className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Editing channel #${channel.name}`),
    },
    {
      label: 'Mute Channel',
      icon: <Bell className="w-3.5 h-3.5" />,
      children: [
        { label: 'For 15 Minutes', onClick: () => showToast(`Muted for 15m`) },
        { label: 'For 1 Hour', onClick: () => showToast(`Muted for 1h`) },
        { label: 'Until I turn it back on', onClick: () => showToast(`Muted indefinitely`) },
      ],
    },
    {
      label: 'Copy Channel ID',
      icon: <Copy className="w-3.5 h-3.5" />,
      onClick: () => {
        navigator.clipboard?.writeText(channel.id);
        showToast(`Copied #${channel.id}`);
      },
    },
    { separator: true },
    {
      label: 'Delete Channel',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Deleted #${channel.name}`),
    },
  ];

  const getMessageContextMenu = (message: Message): ContextMenuItem[] => [
    {
      label: 'Add Reaction',
      icon: <Sparkles className="w-3.5 h-3.5 text-[#5865f2]" />,
      children: [
        { label: '👍 Thumbs Up', onClick: () => handleAddReaction(message.id, '👍') },
        { label: '🚀 Rocket', onClick: () => handleAddReaction(message.id, '🚀') },
        { label: '⚡ Pulse', onClick: () => handleAddReaction(message.id, '⚡') },
        { label: '❤️ Heart', onClick: () => handleAddReaction(message.id, '❤️') },
      ],
    },
    {
      label: 'Reply',
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      onClick: () => setMessageInput(`> ${message.content}\n@${message.author} `),
    },
    {
      label: message.isPinned ? 'Unpin Message' : 'Pin Message',
      icon: <Pin className="w-3.5 h-3.5" />,
      onClick: () => handleTogglePin(message.id),
    },
    {
      label: 'Copy Text',
      icon: <Copy className="w-3.5 h-3.5" />,
      onClick: () => {
        navigator.clipboard?.writeText(message.content);
        showToast('Message text copied');
      },
    },
    { separator: true },
    {
      label: 'Delete Message',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: () => handleDeleteMessage(message.id),
    },
  ];

  const getUserContextMenu = (user: UserProfile): ContextMenuItem[] => [
    {
      label: 'Profile',
      icon: <Shield className="w-3.5 h-3.5" />,
      onClick: () => setInspectedUser(user),
    },
    {
      label: 'Direct Message',
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Opening DM with ${user.name}`),
    },
    {
      label: 'Mute User',
      icon: <Bell className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Muted @${user.callsign}`),
    },
    {
      label: 'Copy User ID',
      icon: <Copy className="w-3.5 h-3.5" />,
      onClick: () => {
        navigator.clipboard?.writeText(user.id);
        showToast(`Copied ID for @${user.callsign}`);
      },
    },
    { separator: true },
    {
      label: 'Block',
      danger: true,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: () => showToast(`Blocked @${user.callsign}`),
    },
  ];

  const handleAttachmentMenu = (e: React.MouseEvent) => {
    openContextMenu(e, [
      {
        label: 'Upload a File',
        icon: <Plus className="w-3.5 h-3.5" />,
        onClick: () => showToast('Vault S3 upload gate triggered'),
      },
      {
        label: 'Create Archival Thread',
        icon: <Archive className="w-3.5 h-3.5" />,
        onClick: () => showToast('Opening Thread builder'),
      },
      {
        label: 'Quantum Key Exchange (E2EE)',
        icon: <Key className="w-3.5 h-3.5 text-[#23a55a]" />,
        onClick: () => showToast('Initiated Double Ratchet handshake'),
      },
    ]);
  };

  const getChannelIcon = (type: Channel['type']) => {
    switch (type) {
      case 'voice': return <Volume2 className="w-4 h-4 text-[#80848e]" />;
      case 'announcement': return <Activity className="w-4 h-4 text-[#80848e]" />;
      case 'archive': return <Archive className="w-4 h-4 text-[#80848e]" />;
      case 'gallery': return <ImageIcon className="w-4 h-4 text-[#80848e]" />;
      case 'text':
      default:
        return <Hash className="w-4 h-4 text-[#80848e]" />;
    }
  };

  const getStatusColor = (status: UserProfile['status']) => {
    switch (status) {
      case 'online': return 'bg-[#23a55a]';
      case 'idle': return 'bg-[#f0b232]';
      case 'dnd': return 'bg-[#f23f43]';
      case 'ghost': return 'bg-[#80848e]';
    }
  };

  const currentFontFamily = THEME.fonts.find(f => f.id === selectedFont)?.family || 'inherit';

  return (
    <div 
      className="flex flex-col h-screen w-screen bg-[#1e1f22] text-[#dbdee1] select-none overflow-hidden"
      style={{ fontFamily: currentFontFamily }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-3 right-4 z-[99999] bg-[#111214] border border-[#35363c] text-white px-3.5 py-2 rounded-[4px] shadow-2xl text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#00f0ff] animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Titlebar Window Frame */}
      <div className="h-6 bg-[#1e1f22] border-b border-[#111214] flex items-center justify-between px-3 text-[11px] text-[#949ba4] font-medium shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-[#00f0ff]" />
          <span>Subspace Frequency — Aegis Command Station</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase text-[#00f0ff] bg-[#00f0ff]/10 px-1.5 py-0.5 rounded">
            {platform.platformName}
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="hover:text-white cursor-pointer">—</span>
            <span className="hover:text-white cursor-pointer">□</span>
            <span className="hover:text-[#f23f43] cursor-pointer">✕</span>
          </div>
        </div>
      </div>

      {/* Main Multi-Panel Workspace */}
      <div className="flex flex-1 min-h-0">
        {/* 1. Server Rail (Far Left) - Discord Authentic 72px */}
        <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 shrink-0 z-20">
          {/* Subspace Gateway / Home DM Button */}
          <div className="relative flex items-center justify-center w-full group">
            {/* White Capsule Indicator Pill */}
            <span 
              className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                selectedBeaconId === 'home' ? 'h-10' : 'h-0 group-hover:h-5'
              }`} 
            />
            <button
              onClick={() => setSelectedBeaconId('home')}
              onContextMenu={(e) => {
                openContextMenu(e, [
                  { label: 'Direct Messages', onClick: () => setSelectedBeaconId('home') },
                  { label: 'Subspace Quick Scan', shortcut: 'Ctrl+K', onClick: () => setIsQuickScanOpen(true) },
                  { separator: true },
                  { label: 'Settings', onClick: () => setIsSettingsOpen(true) },
                ]);
              }}
              className={`w-12 h-12 flex items-center justify-center transition-all duration-200 ${
                selectedBeaconId === 'home'
                  ? 'rounded-[16px] bg-[#00f0ff] text-[#07090e] shadow-[0_0_20px_rgba(0,240,255,0.4)]'
                  : 'rounded-[24px] hover:rounded-[16px] bg-[#313338] text-[#dbdee1] hover:bg-[#00f0ff] hover:text-[#07090e]'
              }`}
              title="Direct Messages"
            >
              <Radio className="w-6 h-6" />
            </button>
          </div>

          <div className="w-8 h-[2px] bg-[#35363c] rounded-[1px] my-1" />

          {/* Servers / Beacons List */}
          <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto overflow-x-hidden">
            {beacons.map((beacon) => {
              const isSelected = selectedBeaconId === beacon.id;
              return (
                <div key={beacon.id} className="relative flex items-center justify-center w-full group">
                  {/* Active / Unread Pill */}
                  <span 
                    className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                      isSelected 
                        ? 'h-10' 
                        : beacon.unreadCount 
                        ? 'h-2 group-hover:h-5' 
                        : 'h-0 group-hover:h-5'
                    }`} 
                  />
                  <button
                    onClick={() => setSelectedBeaconId(beacon.id)}
                    onContextMenu={(e) => openContextMenu(e, getBeaconContextMenu(beacon))}
                    style={{ background: isSelected ? beacon.gradient : undefined }}
                    className={`w-12 h-12 flex items-center justify-center font-bold text-sm transition-all duration-200 relative ${
                      isSelected 
                        ? 'rounded-[16px] text-white shadow-lg' 
                        : 'rounded-[24px] hover:rounded-[16px] bg-[#313338] text-[#dbdee1] hover:bg-[#5865f2] hover:text-white'
                    }`}
                  >
                    {beacon.iconText}
                    {beacon.unreadCount && beacon.unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-[#f23f43] text-white text-[10px] font-bold h-5 min-w-[20px] px-1 rounded-full flex items-center justify-center border-2 border-[#1e1f22]">
                        {beacon.unreadCount}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}

            {/* Add Server & Discovery Buttons */}
            <div className="relative flex items-center justify-center w-full group mt-1">
              <span className="absolute left-0 w-1 bg-white rounded-r-full h-0 group-hover:h-5 transition-all" />
              <button
                onClick={() => showToast('Open Beacon Discovery')}
                className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#313338] hover:bg-[#23a55a] text-[#23a55a] hover:text-white flex items-center justify-center transition-all duration-200"
                title="Add a Server"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <div className="relative flex items-center justify-center w-full group">
              <span className="absolute left-0 w-1 bg-white rounded-r-full h-0 group-hover:h-5 transition-all" />
              <button
                onClick={() => showToast('Explore Public Beacons')}
                className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#313338] hover:bg-[#23a55a] text-[#23a55a] hover:text-white flex items-center justify-center transition-all duration-200"
                title="Explore Discoverable Servers"
              >
                <Compass className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* 2. Channel Sidebar (240px) - Discord Authentic */}
        <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 border-r border-[#1f2023]/60">
          {/* Server Dropdown Header */}
          <div 
            onClick={(e) => {
              const currentBeacon = beacons.find(b => b.id === selectedBeaconId) || beacons[0];
              openContextMenu(e, getBeaconContextMenu(currentBeacon));
            }}
            onContextMenu={(e) => {
              const currentBeacon = beacons.find(b => b.id === selectedBeaconId) || beacons[0];
              openContextMenu(e, getBeaconContextMenu(currentBeacon));
            }}
            className="h-12 px-4 border-b border-[#1f2023] flex items-center justify-between font-bold text-white shadow-sm hover:bg-[#35373c] cursor-pointer transition-colors"
          >
            <span className="truncate text-sm">
              {beacons.find(b => b.id === selectedBeaconId)?.name || 'Aegis Command'}
            </span>
            <ChevronDown className="w-4 h-4 text-[#949ba4]" />
          </div>

          {/* Channels & Categories List */}
          <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
            {categories.map((cat) => {
              const isCollapsed = collapsedCategories[cat.id];
              return (
                <div key={cat.id}>
                  {/* Category Header */}
                  <div
                    onClick={() => setCollapsedCategories(p => ({ ...p, [cat.id]: !p[cat.id] }))}
                    className="flex items-center justify-between text-[12px] font-bold tracking-wider text-[#949ba4] uppercase px-1 py-1 hover:text-white cursor-pointer group"
                  >
                    <div className="flex items-center gap-1">
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 text-[#949ba4]" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-[#949ba4]" />
                      )}
                      <span>{cat.name}</span>
                    </div>
                    <Plus 
                      className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity" 
                      onClick={(e) => {
                        e.stopPropagation();
                        showToast(`Create Channel in ${cat.name}`);
                      }}
                    />
                  </div>

                  {/* Channel Items */}
                  {!isCollapsed && (
                    <div className="space-y-0.5 mt-0.5">
                      {cat.channels.map((chan) => {
                        const isSelected = selectedChannelId === chan.id;
                        return (
                          <div
                            key={chan.id}
                            data-channel-id={chan.id}
                            onClick={() => {
                              setSelectedChannelId(chan.id);
                              if (chan.type === 'voice') {
                                setInVoiceRoom(true);
                              }
                            }}
                            onContextMenu={(e) => openContextMenu(e, getChannelContextMenu(chan))}
                            className={`group flex items-center gap-2 px-2 py-1.5 rounded-[4px] text-sm font-medium transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[#35373c] text-white'
                                : 'text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]'
                            }`}
                          >
                            {getChannelIcon(chan.type)}
                            <span className="truncate">{chan.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Connected Voice Bar (when active) */}
          {inVoiceRoom && (
            <div className="bg-[#232428] border-t border-[#1f2023] px-3 py-2 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] animate-ping" />
                  <span className="font-semibold text-[#23a55a]">Voice Connected</span>
                </div>
                <button 
                  onClick={() => setInVoiceRoom(false)}
                  className="p-1 rounded hover:bg-[#35373c] text-[#f23f43]"
                  title="Disconnect"
                >
                  <PhoneOff className="w-4 h-4" />
                </button>
              </div>
              <div className="text-[11px] text-[#949ba4] truncate mb-2">
                Bridge Comm-Link [Alpha] / 128 kbps
              </div>
              <div className="flex gap-1.5">
                <button className="flex-1 bg-[#2b2d31] hover:bg-[#35373c] py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1">
                  <Video className="w-3.5 h-3.5" /> Video
                </button>
                <button className="flex-1 bg-[#2b2d31] hover:bg-[#35373c] py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1">
                  <Monitor className="w-3.5 h-3.5" /> Share Screen
                </button>
              </div>
            </div>
          )}

          {/* User Status Bar Footer (Discord Authentic 52px) */}
          <div className="h-[52px] bg-[#232428] px-2 py-1.5 flex items-center justify-between shrink-0 relative">
            {/* User Identity Pill */}
            <div
              onClick={() => setIsUserPopoutOpen(p => !p)}
              onContextMenu={(e) => openContextMenu(e, getUserContextMenu(currentUser))}
              className="flex items-center gap-2 p-1 -ml-1 rounded-[4px] hover:bg-[#35373c] cursor-pointer min-w-0 flex-1 transition-colors"
            >
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-base">
                  {currentUser.avatar}
                </div>
                <span 
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#232428] ${getStatusColor(currentUser.status)}`} 
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate flex items-center gap-1">
                  {currentUser.name}
                </div>
                <div className="text-[11px] text-[#949ba4] truncate">
                  {currentUser.statusText || `@${currentUser.callsign}`}
                </div>
              </div>
            </div>

            {/* Audio & Settings Buttons */}
            <div className="flex items-center text-[#b5bac1]">
              <button
                onClick={() => setIsMuted(p => !p)}
                className={`p-1.5 rounded-[4px] hover:bg-[#35373c] transition-colors ${isMuted ? 'text-[#f23f43]' : 'hover:text-[#dbdee1]'}`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsDeafened(p => !p)}
                className={`p-1.5 rounded-[4px] hover:bg-[#35373c] transition-colors ${isDeafened ? 'text-[#f23f43]' : 'hover:text-[#dbdee1]'}`}
                title={isDeafened ? 'Undeafen' : 'Deafen'}
              >
                <Headphones className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-1.5 rounded-[4px] hover:bg-[#35373c] hover:text-[#dbdee1] transition-colors"
                title="User Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>

            {/* User Popout Panel (Discord Exact) */}
            {isUserPopoutOpen && (
              <div className="absolute bottom-[56px] left-2 z-50">
                <ProfileCard
                  user={currentUser}
                  onStatusChange={(st) => {
                    setCurrentUser(p => ({ ...p, status: st }));
                    showToast(`Status updated to ${st}`);
                  }}
                  onClose={() => setIsUserPopoutOpen(false)}
                />
              </div>
            )}
          </div>
        </div>

        {/* 3. Main Chat Viewport (Discord Authentic) */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#313338] h-full">
          {/* Top Header Bar */}
          <div className="h-12 px-4 border-b border-[#232428] flex items-center justify-between shrink-0 bg-[#313338] shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Hash className="w-6 h-6 text-[#80848e]" />
              <span className="font-bold text-white text-base truncate">
                quantum-transmissions
              </span>
              <div className="w-[1px] h-4 bg-[#4e5058] mx-2 hidden sm:block" />
              <span className="text-xs text-[#949ba4] truncate hidden sm:inline">
                Direct Quantum Encryption Active (Double Ratchet Subspace)
              </span>
            </div>

            {/* Right Action Icons */}
            <div className="flex items-center gap-3 text-[#b5bac1]">
              <button
                onClick={() => setIsPinnedDrawerOpen(p => !p)}
                className={`p-1 rounded-[4px] hover:bg-[#35373c] transition-colors ${isPinnedDrawerOpen ? 'text-white' : 'hover:text-white'}`}
                title="Pinned Messages"
              >
                <Pin className="w-5 h-5" />
              </button>
              <button
                onClick={() => setIsMemberPanelOpen(p => !p)}
                className={`p-1 rounded-[4px] hover:bg-[#35373c] transition-colors ${isMemberPanelOpen ? 'text-white' : 'hover:text-white'}`}
                title="Member List"
              >
                <Users className="w-5 h-5" />
              </button>

              {/* Quick Search */}
              <div 
                onClick={() => setIsQuickScanOpen(true)}
                className="bg-[#1e1f22] text-[#949ba4] text-xs px-2 py-1 rounded-[4px] flex items-center gap-2 w-36 hover:w-52 transition-all cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-[#80848e]" />
                <span className="truncate">Search</span>
                <kbd className="text-[10px] font-mono bg-[#2b2d31] px-1 rounded ml-auto">Ctrl+K</kbd>
              </div>

              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-1 rounded-[4px] hover:bg-[#35373c] hover:text-white transition-colors"
                title="Help"
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages Feed (Timeline Style) */}
          <div className="flex-1 overflow-y-auto py-4 select-text">
            {/* Channel Welcome Banner */}
            <div className="px-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-[#404249] flex items-center justify-center text-white mb-2">
                <Hash className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-white">Welcome to #quantum-transmissions!</h2>
              <p className="text-sm text-[#949ba4] mt-1">This is the start of the #quantum-transmissions frequency band.</p>
            </div>

            {/* Date Separator */}
            <div className="relative flex items-center justify-center my-4 mx-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#3f4147]" />
              </div>
              <span className="relative bg-[#313338] px-2 text-[12px] font-semibold text-[#949ba4]">
                September 6, 2026
              </span>
            </div>

            {/* Messages */}
            <div className="space-y-0.5">
              {messages.map((m) => {
                const authorMember = members.find(mem => mem.name === m.author) || {
                  id: `u-${m.author}`,
                  name: m.author,
                  callsign: m.callsign,
                  avatar: m.avatar,
                  status: 'online' as const,
                  staffRank: m.staffRank,
                };

                return (
                  <div
                    key={m.id}
                    data-message-id={m.id}
                    onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                    className="px-4 py-1 hover:bg-[#2e3035] transition-colors relative group flex items-start gap-4"
                  >
                    {/* Floating Hover Action Bar */}
                    <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <MessageActionBar
                        onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                        onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                        onPin={() => handleTogglePin(m.id)}
                        onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                      />
                    </div>

                    {/* Avatar */}
                    <div
                      onClick={() => setInspectedUser(authorMember)}
                      className="w-10 h-10 rounded-full bg-[#111214] flex items-center justify-center text-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity mt-0.5"
                    >
                      {m.avatar}
                    </div>

                    {/* Message Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span
                          onClick={() => setInspectedUser(authorMember)}
                          style={{ color: m.roleColor || '#f2f3f5' }}
                          className="font-medium text-[15px] hover:underline cursor-pointer"
                        >
                          {m.author}
                        </span>

                        {m.roleBadge && (
                          <span className="bg-[#5865f2] text-white text-[10px] font-bold px-1 rounded uppercase">
                            {m.roleBadge}
                          </span>
                        )}

                        <span className="text-[11px] text-[#949ba4]">
                          {m.timestamp}
                        </span>

                        {m.isPinned && (
                          <span className="text-[10px] text-[#00f0ff] font-mono flex items-center gap-0.5">
                            <Pin className="w-2.5 h-2.5" /> Pinned
                          </span>
                        )}
                      </div>

                      <div className="text-[15px] text-[#dbdee1] leading-[1.375rem] mt-0.5 break-words">
                        {m.content}
                      </div>

                      {/* Reaction Pills */}
                      {m.reactions && m.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.reactions.map((r, rIdx) => (
                            <button
                              key={rIdx}
                              onClick={() => handleAddReaction(m.id, r.emoji)}
                              className="rounded-[8px] bg-[#2b2d31] hover:bg-[#35373c] border border-transparent hover:border-[#4e5058] px-2 py-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1] transition-colors"
                            >
                              <span>{r.emoji}</span>
                              <span className="font-semibold text-[11px] text-[#dbdee1]">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Message Input Container (Discord Authentic Inset Pill) */}
          <form onSubmit={handleSendMessage} className="px-4 pb-6 pt-0 bg-[#313338]">
            <div className="bg-[#383a40] rounded-[8px] flex items-center px-4 py-2.5 gap-3 focus-within:shadow-md">
              {/* Plus Button */}
              <button
                type="button"
                onClick={handleAttachmentMenu}
                className="w-6 h-6 rounded-full bg-[#4e5058] hover:bg-[#b5bac1] text-[#313338] flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
                title="Add attachment or handshake"
              >
                +
              </button>

              {/* Text Input */}
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Message #quantum-transmissions"
                maxLength={2000}
                className="bg-transparent flex-1 text-[#dbdee1] placeholder-[#80848e] text-[15px] outline-none"
              />

              {/* Input Action Icons */}
              <div className="flex items-center gap-2.5 text-[#b5bac1]">
                <button type="button" className="hover:text-white transition-colors" title="Send a gift">
                  <Gift className="w-5 h-5" />
                </button>
                <button type="button" className="hover:text-white text-xs font-bold font-mono px-1 rounded bg-[#4e5058]/40 transition-colors" title="Open GIF picker">
                  GIF
                </button>
                <button type="button" className="hover:text-white transition-colors" title="Select Emoji">
                  <Smile className="w-5 h-5" />
                </button>
                {messageInput.trim() && (
                  <button type="submit" className="text-[#00f0ff] hover:text-white transition-colors">
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* 4. Transmitters / Member Sidebar (240px) */}
        {isMemberPanelOpen && (
          <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 border-l border-[#1f2023]/60 select-none">
            <div className="flex-1 overflow-y-auto px-2 py-4 space-y-4">
              {/* Fleet Command Role Group */}
              <div>
                <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase px-2 mb-1">
                  Fleet Command — {members.filter(m => m.staffRank && m.staffRank >= 2).length}
                </div>
                <div className="space-y-0.5">
                  {members.filter(m => m.staffRank && m.staffRank >= 2).map((m) => (
                    <div
                      key={m.id}
                      data-member-id={m.id}
                      onClick={() => setInspectedUser(m)}
                      onContextMenu={(e) => openContextMenu(e, getUserContextMenu(m))}
                      className="px-2 py-1.5 rounded-[4px] hover:bg-[#35373c] cursor-pointer flex items-center gap-3 transition-colors group"
                    >
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-sm">
                          {m.avatar}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#2b2d31] ${getStatusColor(m.status)}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#00f0ff] group-hover:text-white truncate flex items-center gap-1">
                          {m.name}
                        </div>
                        <div className="text-[11px] text-[#949ba4] truncate">
                          {m.statusText || `@${m.callsign}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Enlisted Crew Role Group */}
              <div>
                <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase px-2 mb-1">
                  Enlisted Transmitters — {members.filter(m => !m.staffRank || m.staffRank < 2).length}
                </div>
                <div className="space-y-0.5">
                  {members.filter(m => !m.staffRank || m.staffRank < 2).map((m) => (
                    <div
                      key={m.id}
                      onClick={() => setInspectedUser(m)}
                      onContextMenu={(e) => openContextMenu(e, getUserContextMenu(m))}
                      className="px-2 py-1.5 rounded-[4px] hover:bg-[#35373c] cursor-pointer flex items-center gap-3 transition-colors group"
                    >
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-sm">
                          {m.avatar}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#2b2d31] ${getStatusColor(m.status)}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#dbdee1] group-hover:text-white truncate">
                          {m.name}
                        </div>
                        <div className="text-[11px] text-[#949ba4] truncate">
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

        {/* 5. Pinned Messages Flyout Drawer */}
        {isPinnedDrawerOpen && (
          <div className="w-80 bg-[#2b2d31] border-l border-[#1f2023] flex flex-col shrink-0 animate-in slide-in-from-right duration-150 select-none">
            <div className="h-12 px-4 border-b border-[#1f2023] flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Pin className="w-4 h-4 text-[#00f0ff]" />
                <span>Pinned Messages</span>
              </div>
              <button 
                onClick={() => setIsPinnedDrawerOpen(false)}
                className="p-1 rounded hover:bg-[#35373c] text-[#949ba4] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.filter(m => m.isPinned).length === 0 ? (
                <div className="text-xs text-[#949ba4] text-center mt-10">
                  No pinned messages in this channel.
                </div>
              ) : (
                messages.filter(m => m.isPinned).map(m => (
                  <div
                    key={`pin-${m.id}`}
                    onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                    className="p-3 rounded-[8px] bg-[#313338] border border-[#232428] space-y-2 hover:border-[#5865f2] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{m.author}</span>
                      <span className="text-[10px] text-[#949ba4]">{m.timestamp}</span>
                    </div>
                    <p className="text-xs text-[#dbdee1] leading-relaxed">{m.content}</p>
                    <div className="flex justify-end gap-2 pt-1 border-t border-[#232428]">
                      <button
                        onClick={() => handleTogglePin(m.id)}
                        className="text-[10px] text-[#f23f43] hover:underline"
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
      </div>

      {/* User Profile Modal (when clicking other users) */}
      <Modal
        isOpen={Boolean(inspectedUser)}
        onClose={() => setInspectedUser(null)}
        title="User Profile"
        maxWidth="md"
      >
        {inspectedUser && (
          <div className="flex justify-center py-2">
            <ProfileCard
              user={inspectedUser}
              onSendMessage={(uid) => {
                setInspectedUser(null);
                showToast(`Opening DM with ${uid}`);
              }}
              onClose={() => setInspectedUser(null)}
            />
          </div>
        )}
      </Modal>

      {/* Quick Scan (Ctrl+K) Modal */}
      <Modal
        isOpen={isQuickScanOpen}
        onClose={() => setIsQuickScanOpen(false)}
        title="Quick Switcher"
        description="Search channels, direct transmissions, or commands."
        maxWidth="lg"
      >
        <div className="flex flex-col gap-4">
          <Input
            autoFocus
            icon={<Search className="w-4 h-4" />}
            placeholder="Where would you like to go?"
            value={quickScanQuery}
            onChange={(e) => setQuickScanQuery(e.target.value)}
          />

          <div className="space-y-1 mt-2">
            <div className="text-[11px] font-bold uppercase text-[#949ba4] px-1">Channels</div>
            {categories.flatMap(c => c.channels).map((chan) => (
              <div
                key={chan.id}
                onClick={() => {
                  setSelectedChannelId(chan.id);
                  setIsQuickScanOpen(false);
                }}
                className="flex items-center justify-between p-2 rounded-[4px] hover:bg-[#35373c] cursor-pointer text-sm text-[#dbdee1] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  {getChannelIcon(chan.type)}
                  <span>{chan.name}</span>
                </div>
                <span className="text-[10px] text-[#949ba4] font-mono">JUMP</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Full Discord-Style Settings Modal */}
      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="User Settings"
        maxWidth="2xl"
      >
        <div className="flex gap-6 max-h-[75vh]">
          {/* Settings Left Navigation */}
          <div className="w-48 flex flex-col gap-1 border-r border-[#232428] pr-4 shrink-0 text-xs font-medium">
            <div className="text-[10px] uppercase font-bold text-[#949ba4] px-2 py-1">User Settings</div>
            <button
              onClick={() => setActiveSettingsTab('profile')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'profile' ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              My Account & Identity
            </button>
            <button
              onClick={() => setActiveSettingsTab('appearance')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'appearance' ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Appearance & Spectrum
            </button>
            <button
              onClick={() => setActiveSettingsTab('badges')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'badges' ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Commendations & Badges
            </button>
            <button
              onClick={() => setActiveSettingsTab('voice')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'voice' ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Voice & Video
            </button>
          </div>

          {/* Settings Tab Content */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
            {activeSettingsTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Visual Accent Spectrum</h3>
                  <p className="text-xs text-[#949ba4] mb-3">Choose your personal tactical HUD color accent.</p>
                  <ColorWheel color={accentColor} onChange={setAccentColor} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Typography Frequency</h3>
                  <p className="text-xs text-[#949ba4] mb-3">Select the typeface for subspace messages and terminal logs.</p>
                  <FontSelector selectedFont={selectedFont} onChange={setSelectedFont} />
                </div>
              </div>
            )}

            {activeSettingsTab === 'badges' && (
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Commendations & Service Insignia</h3>
                <p className="text-xs text-[#949ba4] mb-3">Earned badges across orbital fleets and tactical nodes.</p>
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
            )}

            {activeSettingsTab === 'profile' && (
              <div className="space-y-4 text-xs">
                <h3 className="text-sm font-bold text-white">My Account Info</h3>
                <div className="bg-[#2b2d31] p-3 rounded-[8px] space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[#949ba4]">Username</span>
                    <span className="text-white font-medium">{currentUser.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#949ba4]">Callsign</span>
                    <span className="text-white font-mono">@{currentUser.callsign}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#949ba4]">Subspace Key Fingerprint</span>
                    <span className="text-[#00f0ff] font-mono">{currentUser.quantumKeyFingerprint}</span>
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === 'voice' && (
              <div className="space-y-4 text-xs">
                <h3 className="text-sm font-bold text-white">Voice & Video Diagnostics</h3>
                <div className="bg-[#2b2d31] p-3 rounded-[8px] space-y-2 text-[#dbdee1]">
                  <p>RTC Engine: LiveKit Subspace WebRTC</p>
                  <p>Audio Codec: Opus 128 kbps Quantum Optimized</p>
                  <p>Echo Cancellation & Noise Suppression: Enabled</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};

// Global App Root with Fallback Context Menu
export const App: React.FC = () => {
  const canvasFallbackItems: ContextMenuItem[] = [
    { label: 'Subspace Frequency Terminal', disabled: true },
    { separator: true },
    {
      label: 'Subspace Quick Scan',
      shortcut: 'Ctrl+K',
      icon: <Search className="w-3.5 h-3.5" />,
      onClick: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })),
    },
    {
      label: 'Subspace Diagnostics',
      icon: <Activity className="w-3.5 h-3.5 text-[#23a55a]" />,
      onClick: () => {
        navigator.clipboard?.writeText(JSON.stringify({ status: 'NOMINAL', latency: '18ms' }, null, 2));
        alert('Quantum diagnostics telemetry copied to clipboard.');
      },
    },
    {
      label: 'Reload App',
      shortcut: 'F5',
      icon: <Radio className="w-3.5 h-3.5" />,
      onClick: () => window.location.reload(),
    },
  ];

  return (
    <ContextMenuProvider fallbackItems={canvasFallbackItems}>
      <AppContent />
    </ContextMenuProvider>
  );
};
