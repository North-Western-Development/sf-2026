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
  Phone,
  Video,
  Monitor,
  UserPlus,
  Compass as BrowseIcon,
  MessageCircle,
  MoreVertical,
  Lock
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
  description?: string;
  unread?: boolean;
}

interface VoiceUser {
  id: string;
  name: string;
  avatar: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
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

interface DirectConversation {
  id: string;
  user: UserProfile;
  unreadCount?: number;
  lastMessage?: string;
  e2eeFingerprint: string;
}

interface FriendItem {
  id: string;
  user: UserProfile;
  relationship: 'online' | 'all' | 'pending' | 'blocked';
  customActivity?: string;
}

// Multi-Server Channels Mapping
const SERVER_DATA: Record<string, { name: string; categories: ChannelCategory[] }> = {
  'beacon-aegis': {
    name: 'Aegis Command Station',
    categories: [
      {
        id: 'cat-priority',
        name: 'Priority Broadcasts',
        channels: [
          { id: 'chan-announcements', name: 'orbital-bulletins', type: 'announcement', description: 'Official fleet announcements from High Command.' },
          { id: 'chan-rules', name: 'protocol-directives', type: 'text', description: 'Rules of engagement and standard operating procedures.' },
        ],
      },
      {
        id: 'cat-relays',
        name: 'Transmission Relays',
        channels: [
          { id: 'chan-quantum', name: 'quantum-transmissions', type: 'text', description: 'General fleet comms and subspace chatter.' },
          { id: 'chan-recon', name: 'telemetry-recon-gallery', type: 'gallery', description: 'Deep space sensor photos and planetary scans.' },
          { id: 'chan-archives', name: 'flight-logs-archive', type: 'archive', description: 'Archived mission flight debriefs and blackbox transcripts.' },
        ],
      },
      {
        id: 'cat-comms',
        name: 'Voice Comm-Links',
        channels: [
          { id: 'chan-bridge', name: 'Bridge Comm-Link [Alpha]', type: 'voice', description: 'Primary bridge audio frequency.' },
          { id: 'chan-squadron', name: 'Squadron Tactical [LiveKit]', type: 'voice', description: 'Low-latency tactical strike communications.' },
        ],
      },
    ],
  },
  'beacon-vanguard': {
    name: 'Vanguard Squadron',
    categories: [
      {
        id: 'cat-flight-ops',
        name: 'Flight Operations',
        channels: [
          { id: 'chan-briefings', name: 'flight-briefings', type: 'announcement', description: 'Pre-flight tactical briefs and waypoints.' },
          { id: 'chan-scout', name: 'scout-recon', type: 'text', description: 'Forward reconnaissance reports from scout wings.' },
          { id: 'chan-orders', name: 'tactical-orders', type: 'text', description: 'Live combat directives from squadron leaders.' },
        ],
      },
      {
        id: 'cat-wing-comms',
        name: 'Flight Wings (Audio)',
        channels: [
          { id: 'chan-alpha-wing', name: 'Alpha Wing Comms', type: 'voice', description: 'Alpha interceptor squadron comms channel.' },
          { id: 'chan-interceptor', name: 'Interceptor Strike', type: 'voice', description: 'Dogfight tactical voice frequency.' },
        ],
      },
      {
        id: 'cat-vanguard-media',
        name: 'Combat Media',
        channels: [
          { id: 'chan-combat-recordings', name: 'combat-footage', type: 'gallery', description: 'Gun-camera and telemetry video captures.' },
          { id: 'chan-after-action', name: 'after-action-reports', type: 'archive', description: 'Mission debriefs and combat damage assessment.' },
        ],
      },
    ],
  },
  'beacon-rim': {
    name: 'Outer Rim Coalition',
    categories: [
      {
        id: 'cat-coalition-hub',
        name: 'Coalition Hub',
        channels: [
          { id: 'chan-treaty', name: 'treaty-bulletins', type: 'announcement', description: 'Interstellar trade pacts and faction treaties.' },
          { id: 'chan-rim-chat', name: 'outer-rim-chat', type: 'text', description: 'Independent pilot and trader general frequency.' },
        ],
      },
      {
        id: 'cat-logistics',
        name: 'Logistics & Cargo',
        channels: [
          { id: 'chan-convoy', name: 'convoy-routing', type: 'text', description: 'Safe jump routes through asteroid belts and piracy zones.' },
          { id: 'chan-manifests', name: 'cargo-manifests', type: 'archive', description: 'Subspace cargo manifests and freight ledgers.' },
        ],
      },
      {
        id: 'cat-rim-voice',
        name: 'Relay Frequencies',
        channels: [
          { id: 'chan-deep-relay', name: 'Deep Space Relay', type: 'voice', description: 'Long-range open relay voice channel.' },
          { id: 'chan-traders-haven', name: 'Traders Comm-Grid', type: 'voice', description: 'Trading post bar & lounge audio.' },
        ],
      },
    ],
  },
  'beacon-sol': {
    name: 'Solaris Research Facility',
    categories: [
      {
        id: 'cat-sol-science',
        name: 'Scientific Observatories',
        channels: [
          { id: 'chan-flare-alerts', name: 'solar-flare-alerts', type: 'announcement', description: 'Coronal mass ejection warnings and radiation forecasts.' },
          { id: 'chan-astrophysics', name: 'astrophysics-lab', type: 'text', description: 'Gravitational wave analytics and dark matter telemetry.' },
          { id: 'chan-quantum-theory', name: 'quantum-resonance', type: 'text', description: 'Subspace particle entanglement experiments.' },
        ],
      },
      {
        id: 'cat-sol-media',
        name: 'Sensor Data',
        channels: [
          { id: 'chan-spectrometry', name: 'spectrometry-scans', type: 'gallery', description: 'High-energy gamma ray and spectrometry captures.' },
        ],
      },
      {
        id: 'cat-sol-audio',
        name: 'Lab Intercoms',
        channels: [
          { id: 'chan-sol-intercom', name: 'Research Deck Audio', type: 'voice', description: 'Solaris lab main microphone relay.' },
        ],
      },
    ],
  },
};

export const AppContent: React.FC = () => {
  const platform = usePlatformEnvironment();
  const { openContextMenu } = useContextMenu();

  // Navigation & Active Selections
  const [selectedBeaconId, setSelectedBeaconId] = useState<string>('beacon-aegis');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('chan-quantum');
  const [selectedDmId, setSelectedDmId] = useState<string>('friends');
  const [friendsTab, setFriendsTab] = useState<'online' | 'all' | 'pending' | 'blocked' | 'add'>('online');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Modals & Panels
  const [isQuickScanOpen, setIsQuickScanOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemberPanelOpen, setIsMemberPanelOpen] = useState(true);
  const [isPinnedDrawerOpen, setIsPinnedDrawerOpen] = useState(false);
  const [isUserPopoutOpen, setIsUserPopoutOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'profile' | 'appearance' | 'voice' | 'badges'>('appearance');

  // Floating Popover for clicking users anywhere in Chat or Member List
  const [hoverUserPopout, setHoverUserPopout] = useState<{
    user: UserProfile;
    x: number;
    y: number;
  } | null>(null);

  // Audio / RTC Comm-Link State
  const [inVoiceRoom, setInVoiceRoom] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  // Settings State
  const [accentColor, setAccentColor] = useState('#00F0FF');
  const [selectedFont, setSelectedFont] = useState('default');
  const [messageInput, setMessageInput] = useState('');
  const [quickScanQuery, setQuickScanQuery] = useState('');
  const [browseChannelQuery, setBrowseChannelQuery] = useState('');
  const [friendsFilterQuery, setFriendsFilterQuery] = useState('');
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
    { id: 'beacon-rim', name: 'Outer Rim Coalition', unreadCount: 1, iconText: 'OR', gradient: 'linear-gradient(135deg, #23a55a, #00f0ff)' },
    { id: 'beacon-sol', name: 'Solaris Research Facility', iconText: 'SR', gradient: 'linear-gradient(135deg, #f0b232, #f23f43)' },
  ]);

  // Voice Channel Inhabitant Directory
  const [voiceUsers, setVoiceUsers] = useState<Record<string, VoiceUser[]>>({
    'chan-bridge': [
      { id: 'u1', name: 'Fleet Admiral Vance', avatar: '👨‍🚀', isSpeaking: true },
      { id: 'u3', name: 'Echo-4 Specialist', avatar: '🛰️', isMuted: true },
    ],
    'chan-squadron': [
      { id: 'u4', name: 'Nova Pilot', avatar: '🛸', isSpeaking: false },
    ],
    'chan-alpha-wing': [
      { id: 'u4', name: 'Nova Pilot', avatar: '🛸', isSpeaking: true },
    ],
    'chan-deep-relay': [
      { id: 'u5', name: 'Dr. Aris Thorne', avatar: '🔬', isMuted: false },
    ],
  });

  // Direct Message Conversations
  const [directConversations] = useState<DirectConversation[]>([
    {
      id: 'dm-vance',
      user: {
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
      unreadCount: 1,
      lastMessage: 'Key ratchet exchange complete. Verify session hash.',
      e2eeFingerprint: 'SF-QKD-9981-FA23',
    },
    {
      id: 'dm-echo',
      user: {
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
      lastMessage: 'Vault S3 presigned gateway is active and synced.',
      e2eeFingerprint: 'SF-QKD-1102-EC44',
    },
    {
      id: 'dm-nova',
      user: {
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
      lastMessage: 'Scouting sector 7 now. All quiet on telemetry.',
      e2eeFingerprint: 'SF-QKD-8831-NV11',
    },
    {
      id: 'dm-aris',
      user: {
        id: 'u5',
        name: 'Dr. Aris Thorne',
        callsign: 'dr_thorne',
        avatar: '🔬',
        status: 'ghost',
        statusText: 'Calibrating quantum spectrometers',
        roles: ['Chief Scientist'],
        bio: 'Solaris Senior Research Fellow.',
        memberSince: 'Mar 12, 2022',
        quantumKeyFingerprint: 'SF-QKD-5590-SL18',
      },
      lastMessage: 'The radiation surge reached 4.2 petawatts.',
      e2eeFingerprint: 'SF-QKD-5590-SL18',
    },
  ]);

  // Friends Directory
  const [friendsList] = useState<FriendItem[]>([
    {
      id: 'f-vance',
      user: directConversations[0].user,
      relationship: 'online',
      customActivity: 'Tactical Fleet Command Deck',
    },
    {
      id: 'f-echo',
      user: directConversations[1].user,
      relationship: 'online',
      customActivity: 'Analyzing Subspace Telemetry',
    },
    {
      id: 'f-nova',
      user: directConversations[2].user,
      relationship: 'online',
      customActivity: 'Flying Recon Mission in Sector 7',
    },
    {
      id: 'f-aris',
      user: directConversations[3].user,
      relationship: 'all',
      customActivity: 'Offline',
    },
    {
      id: 'f-pending-1',
      user: {
        id: 'u6',
        name: 'Cadet Chekov',
        callsign: 'chekov_nav',
        avatar: '🚀',
        status: 'idle',
        statusText: 'Incoming friend request',
        bio: 'Navigation officer in training.',
        memberSince: 'Sep 01, 2026',
        quantumKeyFingerprint: 'SF-QKD-3312-CK99',
      },
      relationship: 'pending',
      customActivity: 'Incoming Friend Request',
    },
  ]);

  // Messages Map
  const [channelMessages, setChannelMessages] = useState<Record<string, Message[]>>({
    'chan-quantum': [
      {
        id: 'm1',
        author: 'Fleet Admiral Vance',
        callsign: 'adm_vance',
        avatar: '👨‍🚀',
        content: 'All subspace arrays report nominal frequency resonance across orbital sector 7.',
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
    ],
    'chan-announcements': [
      {
        id: 'm-ann-1',
        author: 'Fleet Admiral Vance',
        callsign: 'adm_vance',
        avatar: '👨‍🚀',
        content: 'ATTENTION ALL STATIONS: Subspace Frequency Protocol v2.4 upgrade is complete. Multi-platform clients are operational.',
        timestamp: 'Yesterday at 9:00 AM',
        roleColor: '#00f0ff',
        staffRank: 3,
        roleBadge: 'ROOT STAFF',
        isPinned: true,
      },
    ],
    'chan-rules': [
      {
        id: 'm-rules-1',
        author: 'Fleet Admiral Vance',
        callsign: 'adm_vance',
        avatar: '👨‍🚀',
        content: 'Protocol Directives: 1) Maintain clear comms on bridge frequencies. 2) Encrypt all private transmissions via Quantum Double Ratchet. 3) Report solar interference immediately.',
        timestamp: 'Aug 15, 2026',
        roleColor: '#00f0ff',
        staffRank: 3,
        roleBadge: 'ROOT STAFF',
        isPinned: true,
      },
    ],
    'chan-scout': [
      {
        id: 'm-scout-1',
        author: 'Nova Pilot',
        callsign: 'nova_star',
        avatar: '🛸',
        content: 'Vanguard reconnaissance report: Wormhole threshold stabilized. No hostile radiation detected.',
        timestamp: 'Today at 1:15 PM',
        roleColor: '#f0b232',
      },
    ],
    'dm-vance': [
      {
        id: 'dm-v1',
        author: 'Fleet Admiral Vance',
        callsign: 'adm_vance',
        avatar: '👨‍🚀',
        content: 'Officer, our direct channel is protected by Quantum Double Ratchet E2EE. What is the status of the orbital relay?',
        timestamp: 'Today at 2:10 PM',
        roleColor: '#00f0ff',
        staffRank: 3,
      },
      {
        id: 'dm-v2',
        author: 'Command Officer (You)',
        callsign: 'cmdr_you',
        avatar: '⚡',
        content: 'Admiral, telemetry resonance is calibrated to 99.8%. Key ratchet exchange confirmed.',
        timestamp: 'Today at 2:12 PM',
        roleColor: '#00f0ff',
        staffRank: 2,
      },
    ],
    'dm-echo': [
      {
        id: 'dm-e1',
        author: 'Echo-4 Specialist',
        callsign: 'echo_four',
        avatar: '🛰️',
        content: 'Hey Commander, uploaded the latest S3 telemetry logs to Vault. Check the archive when you can.',
        timestamp: 'Today at 11:40 AM',
        roleColor: '#23a55a',
      },
    ],
  });

  // Transmitters / Members of Current Server
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
    {
      id: 'u5',
      name: 'Dr. Aris Thorne',
      callsign: 'dr_thorne',
      avatar: '🔬',
      status: 'ghost',
      statusText: 'Calibrating quantum spectrometers',
      roles: ['Chief Scientist'],
      bio: 'Solaris Senior Research Fellow.',
      memberSince: 'Mar 12, 2022',
      quantumKeyFingerprint: 'SF-QKD-5590-SL18',
    },
  ];

  // Quick Scan Hotkey & Click-outside listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsQuickScanOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsUserPopoutOpen(false);
        setHoverUserPopout(null);
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // When switching servers, automatically pick the first channel in that server if current channel not found
  const currentServer = SERVER_DATA[selectedBeaconId] || SERVER_DATA['beacon-aegis'];
  const currentCategories = currentServer.categories;
  
  // Find current channel object
  const allCurrentChannels = currentCategories.flatMap(c => c.channels);
  const currentChannel = allCurrentChannels.find(c => c.id === selectedChannelId) || allCurrentChannels[0] || {
    id: 'chan-default',
    name: 'general',
    type: 'text' as const,
    description: 'General transmissions',
  };

  // Switch server handler
  const handleSelectServer = (beaconId: string) => {
    setSelectedBeaconId(beaconId);
    if (beaconId === 'home') {
      setSelectedDmId('friends');
    } else {
      const targetServer = SERVER_DATA[beaconId];
      if (targetServer && targetServer.categories.length > 0) {
        const firstChan = targetServer.categories[0].channels[0];
        if (firstChan) {
          setSelectedChannelId(firstChan.id);
        }
      }
    }
  };

  // Join / Leave voice channel
  const handleVoiceChannelClick = (channelId: string) => {
    if (inVoiceRoom === channelId) {
      setSelectedChannelId(channelId);
    } else {
      setInVoiceRoom(channelId);
      setSelectedChannelId(channelId);
      setVoiceUsers(prev => ({
        ...prev,
        [channelId]: [
          ...(prev[channelId] || []).filter(u => u.id !== currentUser.id),
          { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar, isSpeaking: false },
        ],
      }));
      showToast(`Connected to voice frequency`);
    }
  };

  const handleDisconnectVoice = () => {
    if (inVoiceRoom) {
      const room = inVoiceRoom;
      setVoiceUsers(prev => ({
        ...prev,
        [room]: (prev[room] || []).filter(u => u.id !== currentUser.id),
      }));
      setInVoiceRoom(null);
      showToast('Voice disconnected');
    }
  };

  // Send message to active channel or active DM
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;

    const targetKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;

    const newMsg: Message = {
      id: `m-${Date.now()}`,
      author: currentUser.name,
      callsign: currentUser.callsign,
      avatar: currentUser.avatar,
      content: messageInput,
      timestamp: 'Today at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      roleColor: '#00f0ff',
      staffRank: currentUser.staffRank,
      roleBadge: selectedBeaconId === 'home' ? undefined : 'COMMAND STAFF',
    };

    setChannelMessages(prev => ({
      ...prev,
      [targetKey]: [...(prev[targetKey] || []), newMsg],
    }));

    setMessageInput('');
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    const targetKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;
    setChannelMessages(prev => {
      const currentList = prev[targetKey] || [];
      return {
        ...prev,
        [targetKey]: currentList.map(m => {
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
        }),
      };
    });
    showToast(`Reacted with ${emoji}`);
  };

  const handleTogglePin = (messageId: string) => {
    const targetKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;
    setChannelMessages(prev => {
      const currentList = prev[targetKey] || [];
      return {
        ...prev,
        [targetKey]: currentList.map(m => {
          if (m.id !== messageId) return m;
          const newPinned = !m.isPinned;
          showToast(newPinned ? 'Pinned message' : 'Unpinned message');
          return { ...m, isPinned: newPinned };
        }),
      };
    });
  };

  const handleDeleteMessage = (messageId: string) => {
    const targetKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;
    setChannelMessages(prev => ({
      ...prev,
      [targetKey]: (prev[targetKey] || []).filter(m => m.id !== messageId),
    }));
    showToast('Message deleted');
  };

  // Open hovering user popout when clicking a user name or avatar
  const handleOpenUserPopout = (e: React.MouseEvent, user: UserProfile) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverUserPopout({
      user,
      x: rect.left,
      y: rect.top,
    });
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
      label: 'Copy Channel ID',
      icon: <Copy className="w-3.5 h-3.5" />,
      onClick: () => {
        navigator.clipboard?.writeText(channel.id);
        showToast(`Copied #${channel.id}`);
      },
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
      label: 'Direct Message',
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      onClick: () => {
        setSelectedBeaconId('home');
        const dm = directConversations.find(d => d.user.id === user.id);
        if (dm) setSelectedDmId(dm.id);
        else showToast(`Opening DM with ${user.name}`);
      },
    },
    {
      label: 'Copy User ID',
      icon: <Copy className="w-3.5 h-3.5" />,
      onClick: () => {
        navigator.clipboard?.writeText(user.id);
        showToast(`Copied ID for @${user.callsign}`);
      },
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
      ...(selectedBeaconId === 'home'
        ? [
            {
              label: 'Quantum Key Exchange (Double Ratchet)',
              icon: <Key className="w-3.5 h-3.5 text-[#23a55a]" />,
              onClick: () => showToast('Double Ratchet key handshake renewed'),
            },
          ]
        : []),
    ]);
  };

  const getChannelIcon = (type: Channel['type']) => {
    switch (type) {
      case 'voice': return <Volume2 className="w-4 h-4 text-[#80848e] shrink-0" />;
      case 'announcement': return <Activity className="w-4 h-4 text-[#80848e] shrink-0" />;
      case 'archive': return <Archive className="w-4 h-4 text-[#80848e] shrink-0" />;
      case 'gallery': return <ImageIcon className="w-4 h-4 text-[#80848e] shrink-0" />;
      case 'text':
      default:
        return <Hash className="w-4 h-4 text-[#80848e] shrink-0" />;
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

  // Active messages to display
  const activeMessageKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;
  const activeMessages = channelMessages[activeMessageKey] || [];
  const activeDm = directConversations.find(d => d.id === selectedDmId);

  return (
    <div 
      className="flex flex-col h-screen w-screen bg-[#1e1f22] text-[#dbdee1] select-none overflow-hidden"
      style={{ fontFamily: currentFontFamily }}
      onClick={() => {
        if (hoverUserPopout) setHoverUserPopout(null);
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-3 right-4 z-[99999] bg-[#111214] border border-[#35363c] text-white px-3.5 py-2 rounded-[4px] shadow-2xl text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#00f0ff] animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Custom Titlebar: Rendered ONLY on Desktop Client (Tauri), NEVER on Web */}
      {platform.isDesktop && (
        <div className="h-6 bg-[#1e1f22] border-b border-[#111214] flex items-center justify-between px-3 text-[11px] text-[#949ba4] font-medium shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>Subspace Frequency Desktop</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase text-[#00f0ff] bg-[#00f0ff]/10 px-1.5 py-0.5 rounded">
              DESKTOP TAURI CLIENT
            </span>
            <div className="flex items-center gap-2 text-xs">
              <span className="hover:text-white cursor-pointer">—</span>
              <span className="hover:text-white cursor-pointer">□</span>
              <span className="hover:text-[#f23f43] cursor-pointer">✕</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Multi-Panel Workspace */}
      <div className="flex flex-1 min-h-0">
        {/* 2. Server Rail (Far Left) - Discord Authentic 72px */}
        <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 shrink-0 z-20">
          {/* Subspace Gateway / Home DM Button */}
          <div className="relative flex items-center justify-center w-full group">
            <span 
              className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
                selectedBeaconId === 'home' ? 'h-10' : 'h-0 group-hover:h-5'
              }`} 
            />
            <button
              onClick={() => handleSelectServer('home')}
              onContextMenu={(e) => {
                openContextMenu(e, [
                  { label: 'Direct Messages', onClick: () => handleSelectServer('home') },
                  { label: 'Friends', onClick: () => { handleSelectServer('home'); setSelectedDmId('friends'); } },
                  { label: 'Subspace Quick Scan', shortcut: 'Ctrl+K', onClick: () => setIsQuickScanOpen(true) },
                ]);
              }}
              className={`w-12 h-12 flex items-center justify-center transition-all duration-200 ${
                selectedBeaconId === 'home'
                  ? 'rounded-[16px] bg-[#00f0ff] text-[#07090e] shadow-[0_0_20px_rgba(0,240,255,0.4)]'
                  : 'rounded-[24px] hover:rounded-[16px] bg-[#313338] text-[#dbdee1] hover:bg-[#00f0ff] hover:text-[#07090e]'
              }`}
              title="Direct Messages & Friends"
            >
              <Radio className="w-6 h-6" />
            </button>
          </div>

          <div className="w-8 h-[2px] bg-[#35363c] rounded-[1px] my-1" />

          {/* Servers / Beacons List */}
          <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto px-3">
            {beacons.map((beacon) => {
              const isSelected = selectedBeaconId === beacon.id;
              return (
                <div key={beacon.id} className="relative flex items-center justify-center w-full group">
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
                    onClick={() => handleSelectServer(beacon.id)}
                    onContextMenu={(e) => openContextMenu(e, getBeaconContextMenu(beacon))}
                    style={{ background: isSelected ? beacon.gradient : undefined }}
                    className={`w-12 h-12 flex items-center justify-center font-bold text-sm transition-all duration-200 relative ${
                      isSelected 
                        ? 'rounded-[16px] text-white shadow-lg' 
                        : 'rounded-[24px] hover:rounded-[16px] bg-[#313338] text-[#dbdee1] hover:bg-[#5865f2] hover:text-white'
                    }`}
                  >
                    {beacon.iconText}
                    {/* Unread Indicator Badge: Located at Bottom-Right to avoid top clipping! */}
                    {beacon.unreadCount && beacon.unreadCount > 0 && (
                      <span className="absolute -bottom-1 -right-1 bg-[#f23f43] text-white text-[10px] font-bold h-5 min-w-[20px] px-1 rounded-full flex items-center justify-center border-[3px] border-[#1e1f22] z-20 pointer-events-none shadow-md">
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

        {/* 3. Secondary Sidebar (240px) */}
        {selectedBeaconId === 'home' ? (
          /* A. Direct Messages & Friends Sidebar (Home View) */
          <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 border-r border-[#1f2023]/60">
            {/* Top Search Button: "Find or start a conversation" */}
            <div className="h-12 px-2.5 border-b border-[#1f2023] flex items-center">
              <button
                onClick={() => setIsQuickScanOpen(true)}
                className="w-full bg-[#1e1f22] hover:bg-[#111214] text-[#949ba4] text-xs px-2 py-1.5 rounded-[4px] flex items-center justify-between transition-colors shadow-inner"
              >
                <span className="truncate">Find or start a conversation</span>
                <kbd className="text-[10px] font-mono bg-[#2b2d31] px-1 rounded">Ctrl+K</kbd>
              </button>
            </div>

            {/* Home Navigation (Friends) */}
            <div className="px-2 pt-3 pb-1 space-y-0.5">
              <button
                onClick={() => setSelectedDmId('friends')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-[4px] text-sm font-medium transition-colors ${
                  selectedDmId === 'friends'
                    ? 'bg-[#35373c] text-white'
                    : 'text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]'
                }`}
              >
                <Users className="w-5 h-5" />
                <span>Friends</span>
              </button>
            </div>

            {/* Direct Messages List */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-[#949ba4] uppercase px-2 py-1.5 group">
                <span>Direct Messages</span>
                <Plus 
                  className="w-3.5 h-3.5 hover:text-white cursor-pointer" 
                  title="Create DM" 
                  onClick={() => showToast('Start a new direct conversation')}
                />
              </div>

              <div className="space-y-0.5 mt-1">
                {directConversations.map((dm) => {
                  const isSelected = selectedDmId === dm.id;
                  return (
                    <div
                      key={dm.id}
                      onClick={() => setSelectedDmId(dm.id)}
                      onContextMenu={(e) => openContextMenu(e, getUserContextMenu(dm.user))}
                      className={`group flex items-center justify-between px-2 py-2 rounded-[4px] cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#35373c] text-white'
                          : 'text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-sm">
                            {dm.user.avatar}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#2b2d31] ${getStatusColor(dm.user.status)}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span>{dm.user.name}</span>
                            <Lock className="w-3 h-3 text-[#23a55a] shrink-0" title="Quantum E2EE" />
                          </div>
                          <div className="text-[11px] text-[#949ba4] truncate">
                            {dm.lastMessage || dm.user.statusText}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          showToast(`Closed DM with ${dm.user.name}`);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-white rounded"
                        title="Close DM"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom User Bar */}
            <div className="h-[52px] bg-[#232428] px-2 py-1.5 flex items-center justify-between shrink-0 relative">
              <div
                onClick={() => setIsUserPopoutOpen(p => !p)}
                className="flex items-center gap-2 p-1 -ml-1 rounded-[4px] hover:bg-[#35373c] cursor-pointer min-w-0 flex-1 transition-colors"
              >
                <div className="relative shrink-0">
                  <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-base">
                    {currentUser.avatar}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#232428] ${getStatusColor(currentUser.status)}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white truncate">{currentUser.name}</div>
                  <div className="text-[11px] text-[#949ba4] truncate">{currentUser.statusText}</div>
                </div>
              </div>

              <div className="flex items-center text-[#b5bac1]">
                <button onClick={() => setIsMuted(p => !p)} className={`p-1.5 rounded-[4px] hover:bg-[#35373c] ${isMuted ? 'text-[#f23f43]' : 'hover:text-white'}`}>
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button onClick={() => setIsDeafened(p => !p)} className={`p-1.5 rounded-[4px] hover:bg-[#35373c] ${isDeafened ? 'text-[#f23f43]' : 'hover:text-white'}`}>
                  <Headphones className="w-4 h-4" />
                </button>
                <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 rounded-[4px] hover:bg-[#35373c] hover:text-white">
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              {/* User Island Popout (NO ROLES SHOWN FOR CURRENT USER ISLAND) */}
              {isUserPopoutOpen && (
                <div className="absolute bottom-[56px] left-2 z-50">
                  <ProfileCard
                    user={currentUser}
                    hideRoles={true}
                    onStatusChange={(st) => {
                      setCurrentUser(p => ({ ...p, status: st }));
                      showToast(`Status updated to ${st}`);
                    }}
                    onEditProfile={() => {
                      setIsUserPopoutOpen(false);
                      setIsSettingsOpen(true);
                    }}
                    onClose={() => setIsUserPopoutOpen(false)}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          /* B. Server Channels Sidebar */
          <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 border-r border-[#1f2023]/60">
            {/* Server Dropdown Header */}
            <div 
              onClick={(e) => {
                const beacon = beacons.find(b => b.id === selectedBeaconId) || beacons[0];
                openContextMenu(e, getBeaconContextMenu(beacon));
              }}
              onContextMenu={(e) => {
                const beacon = beacons.find(b => b.id === selectedBeaconId) || beacons[0];
                openContextMenu(e, getBeaconContextMenu(beacon));
              }}
              className="h-12 px-4 border-b border-[#1f2023] flex items-center justify-between font-bold text-white shadow-sm hover:bg-[#35373c] cursor-pointer transition-colors"
            >
              <span className="truncate text-sm">{currentServer.name}</span>
              <ChevronDown className="w-4 h-4 text-[#949ba4]" />
            </div>

            {/* Channels & Roles / Browse Channels Header Item */}
            <div className="px-2 pt-3 pb-1">
              <button
                onClick={() => setSelectedChannelId('browse-channels')}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] text-sm font-medium transition-colors ${
                  selectedChannelId === 'browse-channels'
                    ? 'bg-[#35373c] text-white'
                    : 'text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]'
                }`}
              >
                <BrowseIcon className="w-4 h-4 text-[#00f0ff]" />
                <span>Channels & Roles</span>
              </button>
            </div>

            {/* Channels List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
              {currentCategories.map((cat) => {
                const isCollapsed = collapsedCategories[cat.id];
                return (
                  <div key={cat.id}>
                    {/* Category Header */}
                    <div
                      onClick={() => setCollapsedCategories(p => ({ ...p, [cat.id]: !p[cat.id] }))}
                      className="flex items-center justify-between text-[11px] font-bold tracking-wider text-[#949ba4] uppercase px-1 py-1 hover:text-white cursor-pointer group"
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
                          const usersInThisVoice = chan.type === 'voice' ? (voiceUsers[chan.id] || []) : [];

                          return (
                            <div key={chan.id} className="flex flex-col">
                              <div
                                data-channel-id={chan.id}
                                onClick={() => {
                                  if (chan.type === 'voice') {
                                    handleVoiceChannelClick(chan.id);
                                  } else {
                                    setSelectedChannelId(chan.id);
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
                                <span className="truncate flex-1">{chan.name}</span>
                                {chan.type === 'voice' && usersInThisVoice.length > 0 && (
                                  <span className="text-[11px] text-[#23a55a] font-mono px-1 bg-[#23a55a]/10 rounded">
                                    {usersInThisVoice.length}
                                  </span>
                                )}
                              </div>

                              {/* Connected Voice Channel Users List (Directly in the sidebar) */}
                              {chan.type === 'voice' && usersInThisVoice.length > 0 && (
                                <div className="pl-6 pr-1 py-1 space-y-1">
                                  {usersInThisVoice.map((u) => (
                                    <div
                                      key={u.id}
                                      onClick={(e) => {
                                        const member = members.find(m => m.id === u.id) || currentUser;
                                        handleOpenUserPopout(e, member);
                                      }}
                                      className="flex items-center justify-between px-2 py-1 rounded-[4px] hover:bg-[#35373c]/60 cursor-pointer transition-colors group"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div className={`w-6 h-6 rounded-full bg-[#111214] flex items-center justify-center text-xs shrink-0 ${u.isSpeaking ? 'ring-2 ring-[#23a55a]' : ''}`}>
                                          {u.avatar}
                                        </div>
                                        <span className={`text-xs font-medium truncate ${u.isSpeaking ? 'text-[#23a55a]' : 'text-[#dbdee1]'}`}>
                                          {u.name}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1 text-[#949ba4]">
                                        {u.isMuted && <MicOff className="w-3 h-3 text-[#f23f43]" />}
                                        {u.isDeafened && <Headphones className="w-3 h-3 text-[#f23f43]" />}
                                      </div>
                                    </div>
                                  ))}

                                  <button
                                    onClick={() => showToast(`Invite link copied for #${chan.name}`)}
                                    className="w-full text-left px-2 py-0.5 text-[11px] text-[#949ba4] hover:text-white flex items-center gap-1.5 transition-colors"
                                  >
                                    <UserPlus className="w-3 h-3 text-[#23a55a]" />
                                    <span>Invite to Voice</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Active Voice Connection Panel (Bottom) */}
            {inVoiceRoom && (
              <div className="bg-[#232428] border-t border-[#1f2023] px-3 py-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] animate-ping" />
                    <span className="font-semibold text-[#23a55a]">Voice Connected</span>
                  </div>
                  <button 
                    onClick={handleDisconnectVoice}
                    className="p-1 rounded hover:bg-[#35373c] text-[#f23f43]"
                    title="Disconnect"
                  >
                    <PhoneOff className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[11px] text-[#949ba4] truncate mb-2">
                  {allCurrentChannels.find(c => c.id === inVoiceRoom)?.name || 'Comm-Link'} / 128 kbps
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => showToast('Video toggle')} className="flex-1 bg-[#2b2d31] hover:bg-[#35373c] py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1">
                    <Video className="w-3.5 h-3.5" /> Video
                  </button>
                  <button onClick={() => showToast('Screen share toggle')} className="flex-1 bg-[#2b2d31] hover:bg-[#35373c] py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1">
                    <Monitor className="w-3.5 h-3.5" /> Share Screen
                  </button>
                </div>
              </div>
            )}

            {/* Bottom 52px User Footer Bar */}
            <div className="h-[52px] bg-[#232428] px-2 py-1.5 flex items-center justify-between shrink-0 relative">
              <div
                onClick={() => setIsUserPopoutOpen(p => !p)}
                className="flex items-center gap-2 p-1 -ml-1 rounded-[4px] hover:bg-[#35373c] cursor-pointer min-w-0 flex-1 transition-colors"
              >
                <div className="relative shrink-0">
                  <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-base">
                    {currentUser.avatar}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#232428] ${getStatusColor(currentUser.status)}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white truncate">{currentUser.name}</div>
                  <div className="text-[11px] text-[#949ba4] truncate">{currentUser.statusText}</div>
                </div>
              </div>

              <div className="flex items-center text-[#b5bac1]">
                <button onClick={() => setIsMuted(p => !p)} className={`p-1.5 rounded-[4px] hover:bg-[#35373c] ${isMuted ? 'text-[#f23f43]' : 'hover:text-white'}`}>
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button onClick={() => setIsDeafened(p => !p)} className={`p-1.5 rounded-[4px] hover:bg-[#35373c] ${isDeafened ? 'text-[#f23f43]' : 'hover:text-white'}`}>
                  <Headphones className="w-4 h-4" />
                </button>
                <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 rounded-[4px] hover:bg-[#35373c] hover:text-white">
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              {/* User Island Popout (NO ROLES SHOWN FOR CURRENT USER ISLAND) */}
              {isUserPopoutOpen && (
                <div className="absolute bottom-[56px] left-2 z-50">
                  <ProfileCard
                    user={currentUser}
                    hideRoles={true}
                    onStatusChange={(st) => {
                      setCurrentUser(p => ({ ...p, status: st }));
                      showToast(`Status updated to ${st}`);
                    }}
                    onEditProfile={() => {
                      setIsUserPopoutOpen(false);
                      setIsSettingsOpen(true);
                    }}
                    onClose={() => setIsUserPopoutOpen(false)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. Main Viewport Area */}
        {selectedBeaconId === 'home' && selectedDmId === 'friends' ? (
          /* A. Friends List View */
          <div className="flex-1 flex flex-col min-w-0 bg-[#313338] h-full">
            {/* Top Friends Header Bar */}
            <div className="h-12 px-4 border-b border-[#232428] flex items-center justify-between shrink-0 bg-[#313338]">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 font-bold text-white text-base">
                  <Users className="w-5 h-5 text-[#80848e]" />
                  <span>Friends</span>
                </div>

                <div className="w-[1px] h-4 bg-[#4e5058]" />

                {/* Tabs */}
                <div className="flex items-center gap-2 text-sm font-medium">
                  {(['online', 'all', 'pending', 'blocked'] as const).map((tab) => {
                    const count = friendsList.filter(f => tab === 'all' || f.relationship === tab).length;
                    return (
                      <button
                        key={tab}
                        onClick={() => setFriendsTab(tab)}
                        className={`px-2 py-1 rounded-[4px] capitalize transition-colors ${
                          friendsTab === tab ? 'bg-[#35373c] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
                        }`}
                      >
                        {tab} {count > 0 && `(${count})`}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      setFriendsTab('add');
                      showToast('Enter username to send friend beacon');
                    }}
                    className="bg-[#23a55a] text-white px-2.5 py-1 rounded-[4px] text-xs font-semibold hover:bg-[#1f934f] transition-colors ml-2"
                  >
                    Add Friend
                  </button>
                </div>
              </div>
            </div>

            {/* Friends Content + Active Now Panel */}
            <div className="flex-1 flex min-h-0">
              {/* Friends List Column */}
              <div className="flex-1 flex flex-col p-6 overflow-y-auto min-w-0">
                <div className="mb-4">
                  <div className="bg-[#1e1f22] rounded-[4px] flex items-center px-3 py-2 gap-2 text-sm">
                    <Search className="w-4 h-4 text-[#80848e]" />
                    <input
                      type="text"
                      placeholder="Filter friends..."
                      value={friendsFilterQuery}
                      onChange={(e) => setFriendsFilterQuery(e.target.value)}
                      className="bg-transparent flex-1 text-white outline-none placeholder-[#80848e] text-sm"
                    />
                  </div>
                </div>

                <div className="text-xs font-bold uppercase tracking-wider text-[#949ba4] mb-2">
                  {friendsTab.toUpperCase()} — {friendsList.filter(f => friendsTab === 'all' || f.relationship === friendsTab).length}
                </div>

                <div className="space-y-1">
                  {friendsList
                    .filter(f => (friendsTab === 'all' || f.relationship === friendsTab) && 
                      (f.user.name.toLowerCase().includes(friendsFilterQuery.toLowerCase()) || 
                       f.user.callsign.toLowerCase().includes(friendsFilterQuery.toLowerCase())))
                    .map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2.5 hover:bg-[#35373c]/60 rounded-[8px] border-t border-[#35373c]/30 transition-colors group"
                      >
                        <div 
                          className="flex items-center gap-3 cursor-pointer"
                          onClick={(e) => handleOpenUserPopout(e, item.user)}
                        >
                          <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-[#111214] flex items-center justify-center text-lg">
                              {item.user.avatar}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#313338] ${getStatusColor(item.user.status)}`} />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-white group-hover:underline flex items-center gap-1.5">
                              <span>{item.user.name}</span>
                              <span className="text-xs text-[#949ba4] font-normal">@{item.user.callsign}</span>
                            </div>
                            <div className="text-xs text-[#949ba4]">{item.customActivity || item.user.statusText}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const dm = directConversations.find(d => d.user.id === item.user.id);
                              if (dm) setSelectedDmId(dm.id);
                              else showToast(`Opening DM with ${item.user.name}`);
                            }}
                            className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#111214] flex items-center justify-center text-[#b5bac1] hover:text-white transition-colors"
                            title="Message"
                          >
                            <MessageCircle className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => openContextMenu(e, getUserContextMenu(item.user))}
                            className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#111214] flex items-center justify-center text-[#b5bac1] hover:text-white transition-colors"
                            title="More Actions"
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Active Now Sidebar */}
              <div className="w-80 border-l border-[#232428] p-4 hidden lg:flex flex-col shrink-0">
                <h3 className="text-xl font-bold text-white mb-4">Active Now</h3>
                <div className="space-y-3">
                  <div className="p-3 rounded-[8px] bg-[#2b2d31] border border-[#35373c]/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-sm">
                        👨‍🚀
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Fleet Admiral Vance</div>
                        <div className="text-[10px] text-[#00f0ff] font-medium">Bridge Comm-Link [Alpha]</div>
                      </div>
                    </div>
                    <p className="text-xs text-[#949ba4]">Connected to orbital tactical array for 1h 24m.</p>
                  </div>

                  <div className="p-3 rounded-[8px] bg-[#2b2d31] border border-[#35373c]/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#111214] flex items-center justify-center text-sm">
                        🛸
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Nova Pilot</div>
                        <div className="text-[10px] text-[#23a55a] font-medium">Alpha Wing Comms</div>
                      </div>
                    </div>
                    <p className="text-xs text-[#949ba4]">Patrolling jump-point gateway in Sector 7.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : selectedBeaconId === 'home' && activeDm ? (
          /* B. Direct Message Conversation (With Quantum Double Ratchet E2EE!) */
          <div className="flex-1 flex flex-col min-w-0 bg-[#313338] h-full">
            {/* Top DM Header Bar */}
            <div className="h-12 px-4 border-b border-[#232428] flex items-center justify-between shrink-0 bg-[#313338] shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-[#111214] flex items-center justify-center text-xs">
                    {activeDm.user.avatar}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#313338] ${getStatusColor(activeDm.user.status)}`} />
                </div>
                <span className="font-bold text-white text-base truncate">{activeDm.user.name}</span>
                <span className="text-xs text-[#949ba4] truncate hidden sm:inline">@{activeDm.user.callsign}</span>
              </div>

              <div className="flex items-center gap-3 text-[#b5bac1]">
                <button onClick={() => showToast(`Starting voice call with ${activeDm.user.name}`)} className="p-1 hover:text-white" title="Start Voice Call">
                  <Phone className="w-5 h-5" />
                </button>
                <button onClick={() => showToast(`Starting video call with ${activeDm.user.name}`)} className="p-1 hover:text-white" title="Start Video Call">
                  <Video className="w-5 h-5" />
                </button>
                <button onClick={() => setIsPinnedDrawerOpen(p => !p)} className="p-1 hover:text-white" title="Pinned Messages">
                  <Pin className="w-5 h-5" />
                </button>
                <button onClick={(e) => handleOpenUserPopout(e, activeDm.user)} className="p-1 hover:text-white" title="User Profile">
                  <Shield className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quantum Double Ratchet E2EE Verified Security Banner (Strictly in DMs!) */}
            <div className="bg-[#1e1f22] border-b border-[#232428] px-4 py-2 flex items-center justify-between text-xs text-[#23a55a]">
              <div className="flex items-center gap-2 font-mono">
                <Shield className="w-4 h-4 text-[#23a55a]" />
                <span className="font-semibold text-white">Quantum Double Ratchet E2EE Active</span>
                <span className="text-[#949ba4] text-[11px] hidden md:inline">— Direct message session encrypted (Fingerprint: {activeDm.e2eeFingerprint})</span>
              </div>
              <span className="bg-[#23a55a]/10 text-[#23a55a] border border-[#23a55a]/30 text-[10px] font-mono px-2 py-0.5 rounded">
                Ratchet Step #44 Verified
              </span>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto py-4 select-text">
              {/* DM Start Hero */}
              <div className="px-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-[#111214] flex items-center justify-center text-3xl mb-2">
                  {activeDm.user.avatar}
                </div>
                <h2 className="text-2xl font-bold text-white">{activeDm.user.name}</h2>
                <p className="text-sm text-[#949ba4] mt-1">
                  This is the start of your direct encrypted transmission history with <span className="text-white font-medium">@{activeDm.user.callsign}</span>.
                </p>
              </div>

              {/* Messages list */}
              <div className="space-y-0.5">
                {activeMessages.map((m) => (
                  <div
                    key={m.id}
                    data-message-id={m.id}
                    onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                    className="px-4 py-1 hover:bg-[#2e3035] transition-colors relative group flex items-start gap-4"
                  >
                    <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <MessageActionBar
                        onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                        onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                        onPin={() => handleTogglePin(m.id)}
                        onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                      />
                    </div>

                    <div
                      onClick={(e) => handleOpenUserPopout(e, activeDm.user)}
                      className="w-10 h-10 rounded-full bg-[#111214] flex items-center justify-center text-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity mt-0.5"
                    >
                      {m.avatar}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span
                          onClick={(e) => handleOpenUserPopout(e, activeDm.user)}
                          className="font-medium text-[15px] text-white hover:underline cursor-pointer"
                        >
                          {m.author}
                        </span>
                        <span className="text-[11px] text-[#949ba4]">{m.timestamp}</span>
                        {m.isPinned && (
                          <span className="text-[10px] text-[#00f0ff] font-mono flex items-center gap-0.5">
                            <Pin className="w-2.5 h-2.5" /> Pinned
                          </span>
                        )}
                      </div>

                      <div className="text-[15px] text-[#dbdee1] leading-[1.375rem] mt-0.5 break-words">
                        {m.content}
                      </div>

                      {m.reactions && m.reactions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.reactions.map((r, rIdx) => (
                            <button
                              key={rIdx}
                              onClick={() => handleAddReaction(m.id, r.emoji)}
                              className="rounded-[8px] bg-[#2b2d31] hover:bg-[#35373c] px-2 py-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1]"
                            >
                              <span>{r.emoji}</span>
                              <span className="font-semibold text-[11px] text-[#dbdee1]">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* DM Input Pill */}
            <form onSubmit={handleSendMessage} className="px-4 pb-6 pt-0 bg-[#313338]">
              <div className="bg-[#383a40] rounded-[8px] flex items-center px-4 py-2.5 gap-3">
                <button
                  type="button"
                  onClick={handleAttachmentMenu}
                  className="w-6 h-6 rounded-full bg-[#4e5058] hover:bg-[#b5bac1] text-[#313338] flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
                >
                  +
                </button>

                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={`Message @${activeDm.user.name}`}
                  maxLength={2000}
                  className="bg-transparent flex-1 text-[#dbdee1] placeholder-[#80848e] text-[15px] outline-none"
                />

                <div className="flex items-center gap-2.5 text-[#b5bac1]">
                  <button type="button" className="hover:text-white" title="Send a gift">
                    <Gift className="w-5 h-5" />
                  </button>
                  <button type="button" className="hover:text-white text-xs font-bold font-mono px-1 rounded bg-[#4e5058]/40">
                    GIF
                  </button>
                  <button type="button" className="hover:text-white" title="Select Emoji">
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
        ) : selectedChannelId === 'browse-channels' ? (
          /* C. Browse Channels Area ("Channels & Roles") */
          <div className="flex-1 flex flex-col min-w-0 bg-[#313338] h-full overflow-y-auto">
            {/* Header */}
            <div className="h-12 px-6 border-b border-[#232428] flex items-center justify-between shrink-0 bg-[#313338]">
              <div className="flex items-center gap-2 font-bold text-white text-base">
                <BrowseIcon className="w-5 h-5 text-[#00f0ff]" />
                <span>Channels & Roles — Browse Channels</span>
              </div>
            </div>

            <div className="p-8 max-w-4xl mx-auto w-full space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1">Browse Channels</h1>
                <p className="text-sm text-[#949ba4]">Explore and customize all channels available across {currentServer.name}.</p>
              </div>

              {/* Search Channels */}
              <div className="bg-[#1e1f22] rounded-[8px] flex items-center px-4 py-2.5 gap-3 text-sm">
                <Search className="w-4 h-4 text-[#80848e]" />
                <input
                  type="text"
                  placeholder={`Search channels in ${currentServer.name}...`}
                  value={browseChannelQuery}
                  onChange={(e) => setBrowseChannelQuery(e.target.value)}
                  className="bg-transparent flex-1 text-white outline-none placeholder-[#80848e]"
                />
              </div>

              {/* Categorized Channel Directory */}
              <div className="space-y-6">
                {currentCategories.map((cat) => {
                  const filtered = cat.channels.filter(c => 
                    c.name.toLowerCase().includes(browseChannelQuery.toLowerCase()) || 
                    (c.description && c.description.toLowerCase().includes(browseChannelQuery.toLowerCase()))
                  );

                  if (filtered.length === 0) return null;

                  return (
                    <div key={cat.id} className="space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[#949ba4]">{cat.name}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filtered.map((chan) => (
                          <div
                            key={chan.id}
                            className="bg-[#2b2d31] hover:bg-[#35373c] border border-[#35373c] p-3.5 rounded-[8px] flex flex-col justify-between transition-colors group cursor-pointer"
                            onClick={() => {
                              if (chan.type === 'voice') handleVoiceChannelClick(chan.id);
                              else setSelectedChannelId(chan.id);
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="p-2 rounded bg-[#1e1f22] text-[#dbdee1] mt-0.5">
                                {getChannelIcon(chan.type)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white group-hover:underline flex items-center gap-2">
                                  <span>{chan.name}</span>
                                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-[#1e1f22] text-[#949ba4]">
                                    {chan.type}
                                  </span>
                                </div>
                                <p className="text-xs text-[#949ba4] mt-1 leading-relaxed">
                                  {chan.description || 'No description provided.'}
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 pt-2 border-t border-[#35373c]/50 flex justify-end">
                              <button
                                className="bg-[#5865f2] hover:bg-[#4752c4] text-white px-3 py-1 rounded text-xs font-semibold"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (chan.type === 'voice') handleVoiceChannelClick(chan.id);
                                  else setSelectedChannelId(chan.id);
                                }}
                              >
                                View Channel
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* D. Public Server Channel View (Standard Server Channels - NOT E2EE!) */
          <div className="flex-1 flex flex-col min-w-0 bg-[#313338] h-full">
            {/* Top Channel Header Bar */}
            <div className="h-12 px-4 border-b border-[#232428] flex items-center justify-between shrink-0 bg-[#313338] shadow-sm">
              <div className="flex items-center gap-2 min-w-0">
                {getChannelIcon(currentChannel.type)}
                <span className="font-bold text-white text-base truncate">
                  {currentChannel.name}
                </span>
                <div className="w-[1px] h-4 bg-[#4e5058] mx-2 hidden sm:block" />
                <span className="text-xs text-[#949ba4] truncate hidden sm:inline">
                  {currentChannel.description || `${currentServer.name} channel`}
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
                  title="Settings"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* If Channel is Voice & inVoiceRoom, show Voice Lounge Stage */}
            {currentChannel.type === 'voice' && inVoiceRoom === currentChannel.id ? (
              <div className="flex-1 flex flex-col bg-[#111214] p-6 items-center justify-center relative select-none">
                <div className="grid grid-cols-2 gap-6 max-w-2xl w-full">
                  {(voiceUsers[currentChannel.id] || []).map(vu => (
                    <div
                      key={vu.id}
                      className={`bg-[#2b2d31] rounded-[12px] p-8 flex flex-col items-center justify-center relative shadow-lg ${
                        vu.isSpeaking ? 'ring-4 ring-[#23a55a]' : 'border border-[#35373c]'
                      }`}
                    >
                      <div className="w-20 h-20 rounded-full bg-[#111214] flex items-center justify-center text-4xl mb-3">
                        {vu.avatar}
                      </div>
                      <div className="text-sm font-bold text-white flex items-center gap-1.5">
                        <span>{vu.name}</span>
                        {vu.isSpeaking && <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" />}
                      </div>
                      <div className="absolute bottom-3 right-3 text-[#949ba4]">
                        {vu.isMuted && <MicOff className="w-4 h-4 text-[#f23f43]" />}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 text-xs text-[#949ba4]">
                  Participants without video are currently hidden
                </div>
                <button className="mt-2 bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs font-semibold px-4 py-2 rounded-[4px]">
                  Show All Participants
                </button>
              </div>
            ) : (
              /* Messages Feed */
              <div className="flex-1 overflow-y-auto py-4 select-text">
                {/* Channel Welcome Banner */}
                <div className="px-4 mb-6">
                  <div className="w-16 h-16 rounded-full bg-[#404249] flex items-center justify-center text-white mb-2">
                    {getChannelIcon(currentChannel.type)}
                  </div>
                  <h2 className="text-2xl font-bold text-white">Welcome to #{currentChannel.name}!</h2>
                  <p className="text-sm text-[#949ba4] mt-1">
                    {currentChannel.description || `This is the start of the #${currentChannel.name} channel.`}
                  </p>
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
                  {activeMessages.map((m) => {
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

                        {/* Avatar (Opens Hover Popover) */}
                        <div
                          onClick={(e) => handleOpenUserPopout(e, authorMember)}
                          className="w-10 h-10 rounded-full bg-[#111214] flex items-center justify-center text-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity mt-0.5"
                        >
                          {m.avatar}
                        </div>

                        {/* Message Body */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span
                              onClick={(e) => handleOpenUserPopout(e, authorMember)}
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

                            <span className="text-[11px] text-[#949ba4]">{m.timestamp}</span>

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
            )}

            {/* Channel Message Input Container */}
            <form onSubmit={handleSendMessage} className="px-4 pb-6 pt-0 bg-[#313338]">
              <div className="bg-[#383a40] rounded-[8px] flex items-center px-4 py-2.5 gap-3 focus-within:shadow-md">
                <button
                  type="button"
                  onClick={handleAttachmentMenu}
                  className="w-6 h-6 rounded-full bg-[#4e5058] hover:bg-[#b5bac1] text-[#313338] flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
                  title="Add attachment"
                >
                  +
                </button>

                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={`Message #${currentChannel.name}`}
                  maxLength={2000}
                  className="bg-transparent flex-1 text-[#dbdee1] placeholder-[#80848e] text-[15px] outline-none"
                />

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
        )}

        {/* 5. Server Member List Sidebar (240px) */}
        {selectedBeaconId !== 'home' && isMemberPanelOpen && (
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
                      onClick={(e) => handleOpenUserPopout(e, m)}
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
                      onClick={(e) => handleOpenUserPopout(e, m)}
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

        {/* 6. Pinned Messages Drawer */}
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
              {activeMessages.filter(m => m.isPinned).length === 0 ? (
                <div className="text-xs text-[#949ba4] text-center mt-10">
                  No pinned messages in this channel.
                </div>
              ) : (
                activeMessages.filter(m => m.isPinned).map(m => (
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

      {/* 7. Hovering User Profile Popover (Rendered Adjacent to Click Target, NOT Fullscreen Modal!) */}
      {hoverUserPopout && (
        <div 
          className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: hoverUserPopout.x > window.innerWidth / 2 
              ? Math.max(16, hoverUserPopout.x - 350)
              : Math.min(window.innerWidth - 360, hoverUserPopout.x + 10),
            top: Math.max(16, Math.min(window.innerHeight - 480, hoverUserPopout.y - 40)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ProfileCard
            user={hoverUserPopout.user}
            onSendMessage={(uid) => {
              setHoverUserPopout(null);
              setSelectedBeaconId('home');
              const dm = directConversations.find(d => d.user.id === uid);
              if (dm) setSelectedDmId(dm.id);
              else showToast(`Opening DM with ${uid}`);
            }}
            onClose={() => setHoverUserPopout(null)}
          />
        </div>
      )}

      {/* 8. Quick Scan (Ctrl+K) Switcher Modal */}
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

          <div className="space-y-1 mt-2 max-h-72 overflow-y-auto">
            <div className="text-[11px] font-bold uppercase text-[#949ba4] px-1">Channels across servers</div>
            {Object.entries(SERVER_DATA).flatMap(([bId, srv]) => 
              srv.categories.flatMap(c => c.channels.map(chan => ({ ...chan, beaconId: bId, serverName: srv.name })))
            )
            .filter(c => c.name.toLowerCase().includes(quickScanQuery.toLowerCase()))
            .map((chan) => (
              <div
                key={`${chan.beaconId}-${chan.id}`}
                onClick={() => {
                  setSelectedBeaconId(chan.beaconId);
                  setSelectedChannelId(chan.id);
                  setIsQuickScanOpen(false);
                }}
                className="flex items-center justify-between p-2 rounded-[4px] hover:bg-[#35373c] cursor-pointer text-sm text-[#dbdee1] hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  {getChannelIcon(chan.type)}
                  <span>{chan.name}</span>
                  <span className="text-[11px] text-[#949ba4]">in {chan.serverName}</span>
                </div>
                <span className="text-[10px] text-[#949ba4] font-mono">JUMP</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* 9. Discord User Settings Modal */}
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

// Global App Root with Fallback Context Menu (Cleaned: No terminal header!)
export const App: React.FC = () => {
  const canvasFallbackItems: ContextMenuItem[] = [
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
