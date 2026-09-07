import React, { useState, useEffect, useRef } from 'react';
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
  Lock,
  FolderPlus,
  Bell,
  Cloud,
  ShieldAlert,
  HardDrive,
  Terminal,
  Network,
  Pencil,
  GripVertical
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
import { api, ApiBeacon, ApiRelay } from './services/api';
import { gateway } from './services/gateway';
import { InviteModal } from './InviteModal';
import { ServerSettingsModal } from './ServerSettingsModal';
import { CreateServerModal } from './CreateServerModal';
import { CreateChannelModal } from './CreateChannelModal';
import { CreateCategoryModal } from './CreateCategoryModal';
import { PinnedMessagesPopdown } from './PinnedMessagesPopdown';
import { EmojiPickerPopdown } from './EmojiPickerPopdown';
import { FullProfileModal } from './FullProfileModal';
import { MarkdownMessage } from './MarkdownMessage';
import { UploadDisclaimerModal } from './UploadDisclaimerModal';
import { CloudDrivePickerModal, CloudTetherItem } from './CloudDrivePickerModal';
import { SubspaceVaultModal } from './SubspaceVaultModal';
import { IncidentFlareModal } from './IncidentFlareModal';
import { CommandConsoleModal } from './CommandConsoleModal';
import { ArchivalForumView } from './ArchivalForumView';
import { VisualGalleryView } from './VisualGalleryView';
import { CreateMeshModal } from './CreateMeshModal';

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
  discriminator?: string;
  avatar: string;
  content: string;
  timestamp: string;
  timestampMs?: number;
  roleColor?: string;
  staffRank?: number;
  roleBadge?: string;
  isPinned?: boolean;
  isEdited?: boolean;
  editedAt?: string;
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

// Helper functions for dynamic Beacon styling and Relay categorization
const GRADIENTS = [
  'linear-gradient(135deg, #00f0ff, #5865f2)',
  'linear-gradient(135deg, #7928ca, #ff0080)',
  'linear-gradient(135deg, #23a55a, #00f0ff)',
  'linear-gradient(135deg, #f0b232, #f23f43)',
  'linear-gradient(135deg, #eb459e, #5865f2)',
];

function getBeaconGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash + id.charCodeAt(i)) % GRADIENTS.length;
  }
  return GRADIENTS[hash];
}

function getBeaconInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function categorizeRelays(relays: ApiRelay[]): ChannelCategory[] {
  const textRelays: Channel[] = [];
  const voiceRelays: Channel[] = [];
  const mediaRelays: Channel[] = [];

  relays.forEach((r) => {
    let chanType: Channel['type'] = 'text';
    if (r.type === 'voice') chanType = 'voice';
    else if (r.type === 'announcement') chanType = 'announcement';
    else if (r.type === 'archival' || r.type === 'archive') chanType = 'archive';
    else if (r.type === 'visual' || r.type === 'gallery') chanType = 'gallery';

    const ch: Channel = {
      id: r.id,
      name: r.name,
      type: chanType,
      description: r.topic || undefined,
    };

    if (chanType === 'voice') {
      voiceRelays.push(ch);
    } else if (chanType === 'archive' || chanType === 'gallery') {
      mediaRelays.push(ch);
    } else {
      textRelays.push(ch);
    }
  });

  const categories: ChannelCategory[] = [];
  if (textRelays.length > 0) {
    categories.push({ id: 'cat-text', name: 'Text Relays', channels: textRelays });
  }
  
  // Always provide standard Voice Comm-Links for tactical communications
  if (voiceRelays.length === 0) {
    voiceRelays.push(
      { id: 'chan-voice-bridge', name: 'Command Bridge', type: 'voice', description: 'Primary voice bridge' },
      { id: 'chan-voice-tactical', name: 'Tactical Frequency', type: 'voice', description: 'Subspace operational comms' }
    );
  }
  categories.push({ id: 'cat-voice', name: 'Voice Comm-Links', channels: voiceRelays });

  if (mediaRelays.length > 0) {
    categories.push({ id: 'cat-media', name: 'Archival & Media', channels: mediaRelays });
  }
  return categories;
}

// 5-minute message grouping helper: messages by same transmitter within 5 minutes collapse into a unified block
function isGroupedWithPrevious(currentMsg: Message, prevMsg: Message | undefined): boolean {
  if (!prevMsg) return false;
  const sameAuthor =
    (Boolean(currentMsg.callsign) && Boolean(prevMsg.callsign) && currentMsg.callsign === prevMsg.callsign) ||
    (Boolean(currentMsg.author) && Boolean(prevMsg.author) && currentMsg.author === prevMsg.author);
  if (!sameAuthor) return false;

  const currTime = currentMsg.timestampMs || 0;
  const prevTime = prevMsg.timestampMs || 0;
  if (currTime && prevTime) {
    return Math.abs(currTime - prevTime) <= 5 * 60 * 1000;
  }
  return currentMsg.timestamp === prevMsg.timestamp;
}

export const AppContent: React.FC = () => {
  const platform = usePlatformEnvironment();
  const { openContextMenu } = useContextMenu();

  // Initial App Telemetry & Synchronizing State (Loading Screen)
  const [isAppInitializing, setIsAppInitializing] = useState<boolean>(true);

  // Inline Message Editing State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');

  // Navigation & Active Selections
  const [selectedBeaconId, setSelectedBeaconId] = useState<string>('beacon-aegis');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('chan-quantum');
  const [selectedDmId, setSelectedDmId] = useState<string>('friends');
  const [friendsTab, setFriendsTab] = useState<'online' | 'all' | 'pending' | 'blocked' | 'add'>('online');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Resizable Panels State
  const [channelSidebarWidth, setChannelSidebarWidth] = useState<number>(240);
  const [memberPanelWidth, setMemberPanelWidth] = useState<number>(240);
  const [isResizingChannelSidebar, setIsResizingChannelSidebar] = useState(false);
  const [isResizingMemberPanel, setIsResizingMemberPanel] = useState(false);

  // Server Folders & Drag-and-Drop Reordering State
  const [serverOrder, setServerOrder] = useState<string[]>([]);
  const [serverFolders, setServerFolders] = useState<{ id: string; name: string; beaconIds: string[]; isExpanded?: boolean }[]>([]);
  const [draggedBeaconId, setDraggedBeaconId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);

  // Modals & Popovers
  const [isQuickScanOpen, setIsQuickScanOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isServerMenuOpen, setIsServerMenuOpen] = useState(false);
  const [isCreateServerOpen, setIsCreateServerOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [createChannelCategory, setCreateChannelCategory] = useState<string | undefined>(undefined);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isPinnedPopdownOpen, setIsPinnedPopdownOpen] = useState(false);
  const [fullProfileUser, setFullProfileUser] = useState<UserProfile | null>(null);

  // Independent Member List States for Text Channels vs Voice Channels
  const [isTextMemberListOpen, setIsTextMemberListOpen] = useState(true);
  const [isVoiceMemberListOpen, setIsVoiceMemberListOpen] = useState(false);

  // Voice Channel Switch Confirmation Dialog
  const [pendingSwitchChannelId, setPendingSwitchChannelId] = useState<string | null>(null);

  // Custom Server Emojis
  const [beaconEmojisList, setBeaconEmojisList] = useState<{ id: string; name: string; url: string }[]>([]);

  // Subspace Vault & Cloud Drive Tether States
  const [isUploadDisclaimerOpen, setIsUploadDisclaimerOpen] = useState(false);
  const [isCloudPickerOpen, setIsCloudPickerOpen] = useState(false);
  const [isSubspaceVaultOpen, setIsSubspaceVaultOpen] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);

  // Command Console (Staff Administration) & Incident Flare (Reporting) States
  const [isCommandConsoleOpen, setIsCommandConsoleOpen] = useState(false);
  const [incidentFlareTarget, setIncidentFlareTarget] = useState<{
    targetType: 'transmission' | 'transmitter' | 'beacon';
    targetId: string;
    targetLabel: string;
    snippet?: string;
  } | null>(null);

  // Subspace Mesh (Group DM) Modal State
  const [isCreateMeshOpen, setIsCreateMeshOpen] = useState(false);

  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  const [isUserPopoutOpen, setIsUserPopoutOpen] = useState(false);
  const userPopoutRef = useRef<HTMLDivElement>(null);
  const userIslandTriggerRef = useRef<HTMLDivElement>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'profile' | 'appearance' | 'voice' | 'badges' | 'security'>('appearance');

  // Floating Popover for clicking users anywhere in Chat or Member List
  const [hoverUserPopout, setHoverUserPopout] = useState<{
    user: UserProfile;
    x: number;
    y: number;
  } | null>(null);
  const hoverUserPopoutRef = useRef<HTMLDivElement>(null);

  // Close profile popups when clicking outside
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (isUserPopoutOpen) {
        if (
          userPopoutRef.current &&
          !userPopoutRef.current.contains(target) &&
          userIslandTriggerRef.current &&
          !userIslandTriggerRef.current.contains(target)
        ) {
          setIsUserPopoutOpen(false);
        }
      }
      if (hoverUserPopout) {
        if (hoverUserPopoutRef.current && !hoverUserPopoutRef.current.contains(target)) {
          setHoverUserPopout(null);
        }
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [isUserPopoutOpen, hoverUserPopout]);

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

  // Beacons / Servers List (dynamic from real backend)
  const [beacons, setBeacons] = useState<Beacon[]>([]);
  const [serverData, setServerData] = useState<Record<string, { name: string; categories: ChannelCategory[] }>>({});
  const [discoverableBeacons, setDiscoverableBeacons] = useState<ApiBeacon[]>([]);

  // Channel & Category Drag-and-Drop Reorder State
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null);
  const [draggedChannelCategoryId, setDraggedChannelCategoryId] = useState<string | null>(null);
  const [dragOverChannelId, setDragOverChannelId] = useState<string | null>(null);

  // Voice Channel Inhabitant Directory (dynamic from real gateway)
  const [voiceUsers, setVoiceUsers] = useState<Record<string, VoiceUser[]>>({});

  // Direct Message Conversations
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([
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

  // Messages Map (populated dynamically from real backend transmissions)
  const [channelMessages, setChannelMessages] = useState<Record<string, Message[]>>({});

  // Transmitters / Members of Current Server (dynamic from real backend)
  const [members, setMembers] = useState<UserProfile[]>([]);

  // 1. Initial Authentication, Gateway Connection, & Beacons Bootstrap
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const user = await api.ensureAuthenticated();
        if (!mounted) return;

        setCurrentUser({
          id: user.id,
          name: user.displayName || user.username,
          callsign: user.username,
          avatar: user.avatarUrl || '⚡',
          status: 'online',
          statusText: 'Subspace Frequency Terminal Online',
          staffRank: user.staffRank ? user.staffRank : (user.username === 'command_officer' ? 3 : 0),
          roles: user.roles || ((user.staffRank || user.username === 'command_officer') ? ['Command Staff', 'Sysop'] : ['Transmitter']),
          bio: user.bio || 'Subspace Network Operator',
          memberSince: 'Sep 2026',
          quantumKeyFingerprint: `SF-QKD-${user.id.slice(0, 4).toUpperCase()}`,
          isSelf: true,
        });

        // Connect real gateway WebSocket
        gateway.connect();

        // Fetch real beacons from database
        const joined = await api.getJoinedBeacons();
        if (!mounted) return;

        const mappedBeacons: Beacon[] = joined.map(b => ({
          id: b.id,
          name: b.name,
          iconText: getBeaconInitials(b.name),
          gradient: getBeaconGradient(b.id),
        }));
        setBeacons(mappedBeacons);
        setServerOrder(mappedBeacons.map(b => b.id));

        if (mappedBeacons.length > 0) {
          const firstBeaconId = mappedBeacons[0].id;
          setSelectedBeaconId(firstBeaconId);

          try {
            const [relays, membersList] = await Promise.all([
              api.getBeaconRelays(firstBeaconId),
              api.getBeaconMembers(firstBeaconId),
            ]);

            const cats = categorizeRelays(relays);
            setServerData(prev => ({
              ...prev,
              [firstBeaconId]: {
                name: mappedBeacons[0].name,
                categories: cats,
              },
            }));

            const mappedMembers: UserProfile[] = membersList.map(m => ({
              id: m.transmitterId,
              name: m.displayName || m.username,
              callsign: m.username,
              discriminator: m.discriminator || '0001',
              avatar: m.avatarUrl || '👨‍🚀',
              bannerGradient: m.bannerColor ? `linear-gradient(135deg, ${m.bannerColor} 0%, #1a1a24 50%, #00f0ff22 100%)` : undefined,
              status: (m.presence as any) || 'online',
              statusText: m.isOwner ? 'Beacon Commander' : 'Active Transmitter',
              staffRank: m.isOwner ? 3 : (m.staffRank || 0),
              roles: m.isOwner ? ['Beacon Owner', 'Command Staff'] : ['Transmitter'],
              bio: m.bio || 'Subspace Beacon Member',
              memberSince: 'Sep 2026',
              quantumKeyFingerprint: `SF-QKD-${m.transmitterId.slice(0, 4).toUpperCase()}`,
              isSelf: m.transmitterId === user.id,
            }));
            setMembers(mappedMembers);

            const allChans = cats.flatMap(c => c.channels);
            if (allChans.length > 0) {
              const firstChan = allChans[0];
              setSelectedChannelId(firstChan.id);

              const txs = await api.getTransmissions(firstChan.id);
              const sortedTxs = [...txs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
              const mappedMessages: Message[] = sortedTxs.map(tx => {
                const authorObj = tx.author || (tx as any).authorProfile;
                const authorName = authorObj?.displayName || (tx as any).authorName || authorObj?.username || (tx as any).authorUsername || 'Transmitter';
                const callsign = authorObj?.username || (tx as any).authorUsername || 'transmitter';
                const discriminator = authorObj?.discriminator || (tx as any).authorDiscriminator || '0001';
                const avatar = authorObj?.avatarUrl || (tx as any).authorAvatar || '⚡';
                const displayColor = authorObj?.displayColor || (tx as any).authorDisplayColor || '#00f0ff';
                const staffRank = authorObj?.staffRank ?? (tx as any).authorStaffRank ?? 0;
                const createdDate = new Date(tx.createdAt);

                return {
                  id: tx.id,
                  author: authorName,
                  callsign,
                  discriminator,
                  avatar,
                  content: tx.content,
                  timestamp: createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  timestampMs: createdDate.getTime(),
                  roleColor: displayColor,
                  staffRank,
                  roleBadge: staffRank >= 2 ? 'COMMAND STAFF' : undefined,
                  isPinned: tx.isPinned,
                  isEdited: (tx as any).isEdited ?? false,
                  editedAt: (tx as any).editedAt || (tx as any).updatedAt,
                };
              });

              setChannelMessages({ [firstChan.id]: mappedMessages });
            }
          } catch (loadErr) {
            console.warn('Preload initial channel error:', loadErr);
          }
        }

        // Fetch discoverable beacons
        const disc = await api.getDiscoverableBeacons();
        if (mounted) setDiscoverableBeacons(disc);
      } catch (err: any) {
        console.warn('Real backend connection warning:', err);
      } finally {
        if (mounted) {
          setTimeout(() => {
            if (mounted) setIsAppInitializing(false);
          }, 350);
        }
      }
    }

    init();

    // Subscribe to live voice state updates from Gateway
    const unsubVoice = gateway.onVoiceState((evt) => {
      setVoiceUsers((prev) => {
        const next = { ...prev };
        // Remove transmitter from any other channel
        Object.keys(next).forEach((cId) => {
          next[cId] = (next[cId] || []).filter((u) => u.id !== evt.transmitter_id);
        });
        // Add to new channel if currently connected
        if (evt.relay_id) {
          const list = next[evt.relay_id] || [];
          next[evt.relay_id] = [
            ...list,
            {
              id: evt.transmitter_id,
              name: evt.username,
              avatar: '👨‍🚀',
              isSpeaking: evt.is_speaking,
              isMuted: evt.is_muted,
              isDeafened: evt.is_deafened,
            },
          ];
        }
        return next;
      });
    });

    return () => {
      mounted = false;
      unsubVoice();
    };
  }, []);

  // 2. Fetch real Relays & Members whenever a Beacon is selected
  useEffect(() => {
    if (selectedBeaconId === 'home' || !selectedBeaconId) return;
    let mounted = true;

    async function loadBeaconData() {
      try {
        const [relays, membersList] = await Promise.all([
          api.getBeaconRelays(selectedBeaconId),
          api.getBeaconMembers(selectedBeaconId),
        ]);
        if (!mounted) return;

        const cats = categorizeRelays(relays);
        const beaconObj = beacons.find(b => b.id === selectedBeaconId);
        setServerData(prev => ({
          ...prev,
          [selectedBeaconId]: {
            name: beaconObj?.name || 'Beacon',
            categories: cats,
          },
        }));

        // Map real members from database
        const mappedMembers: UserProfile[] = membersList.map(m => ({
          id: m.transmitterId,
          name: m.displayName || m.username,
          callsign: m.username,
          discriminator: m.discriminator || '0001',
          avatar: m.avatarUrl || '👨‍🚀',
          bannerGradient: m.bannerColor ? `linear-gradient(135deg, ${m.bannerColor} 0%, #1a1a24 50%, #00f0ff22 100%)` : undefined,
          status: (m.presence as any) || 'online',
          statusText: m.isOwner ? 'Beacon Commander' : 'Active Transmitter',
          staffRank: m.isOwner ? 3 : (m.staffRank || 0),
          roles: m.isOwner ? ['Beacon Owner', 'Command Staff'] : ['Transmitter'],
          bio: m.bio || 'Subspace Beacon Member',
          memberSince: 'Sep 2026',
          quantumKeyFingerprint: `SF-QKD-${m.transmitterId.slice(0, 4).toUpperCase()}`,
          isSelf: m.transmitterId === currentUser.id,
        }));
        setMembers(mappedMembers);

        // Fetch custom emojis for this beacon
        api.getBeaconEmojis(selectedBeaconId).then(emojis => {
          setBeaconEmojisList(emojis);
        }).catch(() => {});

        // Automatically select the first channel if none or current channel not in this beacon
        const allChans = cats.flatMap(c => c.channels);
        if (allChans.length > 0) {
          if (!selectedChannelId || !allChans.some(c => c.id === selectedChannelId)) {
            setSelectedChannelId(allChans[0].id);
          }
        }
      } catch (err: any) {
        console.warn('Failed to load real beacon relays/members:', err);
      }
    }

    loadBeaconData();
    return () => { mounted = false; };
  }, [selectedBeaconId, beacons]);

  // 3. Fetch real Transmissions whenever a Channel is selected
  useEffect(() => {
    if (selectedBeaconId === 'home' || !selectedChannelId || selectedChannelId === 'browse-channels') return;
    let mounted = true;

    async function loadTransmissions() {
      try {
        const txs = await api.getTransmissions(selectedChannelId);
        if (!mounted) return;

        // Ensure chronological ascending order
        const sortedTxs = [...txs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const mapped: Message[] = sortedTxs.map(tx => {
          const authorObj = tx.author || (tx as any).authorProfile;
          const authorName = authorObj?.displayName || (tx as any).authorName || authorObj?.username || (tx as any).authorUsername || 'Transmitter';
          const callsign = authorObj?.username || (tx as any).authorUsername || 'transmitter';
          const discriminator = authorObj?.discriminator || (tx as any).authorDiscriminator || '0001';
          const avatar = authorObj?.avatarUrl || (tx as any).authorAvatar || '⚡';
          const displayColor = authorObj?.displayColor || (tx as any).authorDisplayColor || '#00f0ff';
          const staffRank = authorObj?.staffRank ?? (tx as any).authorStaffRank ?? 0;

          const createdDate = new Date(tx.createdAt);
          return {
            id: tx.id,
            author: authorName,
            callsign,
            discriminator,
            avatar,
            content: tx.content,
            timestamp: createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestampMs: createdDate.getTime(),
            roleColor: displayColor,
            staffRank,
            roleBadge: staffRank >= 2 ? 'COMMAND STAFF' : undefined,
            isPinned: tx.isPinned,
            isEdited: (tx as any).isEdited ?? false,
            editedAt: (tx as any).editedAt || (tx as any).updatedAt,
          };
        });

        setChannelMessages(prev => ({
          ...prev,
          [selectedChannelId]: mapped,
        }));
      } catch (err: any) {
        console.warn('Failed to load real transmissions:', err);
      }
    }

    loadTransmissions();
    return () => { mounted = false; };
  }, [selectedChannelId, selectedBeaconId]);

  // Column Resize Handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingChannelSidebar) {
        const newWidth = Math.max(180, Math.min(420, e.clientX - 72));
        setChannelSidebarWidth(newWidth);
      }
      if (isResizingMemberPanel) {
        const newWidth = Math.max(180, Math.min(380, window.innerWidth - e.clientX));
        setMemberPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingChannelSidebar(false);
      setIsResizingMemberPanel(false);
    };

    if (isResizingChannelSidebar || isResizingMemberPanel) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingChannelSidebar, isResizingMemberPanel]);

  // Drag and Drop Server Reordering & Folder Clustering Handlers
  const handleServerDragStart = (e: React.DragEvent, beaconId: string) => {
    e.dataTransfer.setData('text/plain', beaconId);
    setDraggedBeaconId(beaconId);
  };

  const handleServerDragOver = (e: React.DragEvent, targetBeaconId: string) => {
    e.preventDefault();
    if (draggedBeaconId && draggedBeaconId !== targetBeaconId) {
      setDragOverTargetId(targetBeaconId);
    }
  };

  const handleServerDrop = (e: React.DragEvent, targetBeaconId: string) => {
    e.preventDefault();
    setDragOverTargetId(null);
    if (!draggedBeaconId || draggedBeaconId === targetBeaconId) return;

    // If dropped directly in the center, form/add to a cluster folder
    const rect = e.currentTarget.getBoundingClientRect();
    const isCenterDrop = e.clientY > rect.top + 10 && e.clientY < rect.bottom - 10;

    if (isCenterDrop) {
      // Check if target is already in a folder
      const existingFolderIndex = serverFolders.findIndex(f => f.beaconIds.includes(targetBeaconId));
      if (existingFolderIndex >= 0) {
        setServerFolders(prev => prev.map((f, idx) => 
          idx === existingFolderIndex && !f.beaconIds.includes(draggedBeaconId)
            ? { ...f, beaconIds: [...f.beaconIds, draggedBeaconId] }
            : f
        ));
      } else {
        // Create new folder cluster
        const newFolderId = `folder-${Date.now()}`;
        setServerFolders(prev => [
          ...prev,
          {
            id: newFolderId,
            name: 'Beacon Cluster',
            beaconIds: [targetBeaconId, draggedBeaconId],
            isExpanded: true,
          },
        ]);
      }
      showToast('Created / Updated Server Folder');
    } else {
      // Reorder in serverOrder
      setServerOrder(prev => {
        const order = prev.length > 0 ? [...prev] : beacons.map(b => b.id);
        const sourceIndex = order.indexOf(draggedBeaconId);
        const targetIndex = order.indexOf(targetBeaconId);
        if (sourceIndex >= 0 && targetIndex >= 0) {
          order.splice(sourceIndex, 1);
          order.splice(targetIndex, 0, draggedBeaconId);
        }
        return order;
      });
      showToast('Reordered servers');
    }
    setDraggedBeaconId(null);
  };

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
        setIsServerSettingsOpen(false);
        setIsInviteModalOpen(false);
        setIsServerMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // When switching servers, automatically pick the first channel in that server
  const currentServer = serverData[selectedBeaconId] || {
    name: beacons.find(b => b.id === selectedBeaconId)?.name || 'Loading Beacon...',
    categories: [],
  };
  const currentCategories = currentServer.categories;
  
  // Find current channel object
  const allCurrentChannels = currentCategories.flatMap(c => c.channels);
  const currentChannel = allCurrentChannels.find(c => c.id === selectedChannelId) || allCurrentChannels[0] || {
    id: 'chan-default',
    name: 'general',
    type: 'text' as const,
    description: 'Subspace transmissions',
  };

  // ─── Category Reorder ─────────────────────────────────────────────────
  const handleCategoryDrop = (targetCategoryId: string) => {
    if (!draggedCategoryId || draggedCategoryId === targetCategoryId) return;
    setServerData(prev => {
      const server = prev[selectedBeaconId];
      if (!server) return prev;
      const cats = [...server.categories];
      const fromIdx = cats.findIndex(c => c.id === draggedCategoryId);
      const toIdx = cats.findIndex(c => c.id === targetCategoryId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = cats.splice(fromIdx, 1);
      cats.splice(toIdx, 0, moved);
      return { ...prev, [selectedBeaconId]: { ...server, categories: cats } };
    });
    setDraggedCategoryId(null);
    setDragOverCategoryId(null);
  };

  // ─── Channel Reorder (within/across categories) ───────────────────────
  const handleChannelDrop = (targetChannelId: string, targetCategoryId: string) => {
    if (!draggedChannelId || !draggedChannelCategoryId) return;
    if (draggedChannelId === targetChannelId) { setDraggedChannelId(null); return; }
    setServerData(prev => {
      const server = prev[selectedBeaconId];
      if (!server) return prev;
      const cats = server.categories.map(c => ({ ...c, channels: [...c.channels] }));
      // Remove dragged channel from its source category
      const srcCat = cats.find(c => c.id === draggedChannelCategoryId);
      if (!srcCat) return prev;
      const chanIdx = srcCat.channels.findIndex(ch => ch.id === draggedChannelId);
      if (chanIdx === -1) return prev;
      const [movedChan] = srcCat.channels.splice(chanIdx, 1);
      // Insert into target category at target position
      const tgtCat = cats.find(c => c.id === targetCategoryId);
      if (!tgtCat) return prev;
      const tgtIdx = tgtCat.channels.findIndex(ch => ch.id === targetChannelId);
      tgtCat.channels.splice(tgtIdx === -1 ? tgtCat.channels.length : tgtIdx, 0, movedChan);
      return { ...prev, [selectedBeaconId]: { ...server, categories: cats } };
    });
    setDraggedChannelId(null);
    setDraggedChannelCategoryId(null);
    setDragOverChannelId(null);
  };

  // Switch server handler
  const handleSelectServer = (beaconId: string) => {
    setSelectedBeaconId(beaconId);
    if (beaconId === 'home') {
      setSelectedDmId('friends');
    } else {
      const targetServer = serverData[beaconId];
      if (targetServer && targetServer.categories.length > 0) {
        const firstChan = targetServer.categories[0].channels[0];
        if (firstChan) {
          setSelectedChannelId(firstChan.id);
        }
      }
    }
  };

  // Two-Click Voice Channel Workflow with Switch Confirmation
  const handleVoiceChannelClick = (channelId: string) => {
    // If clicking a different voice channel while already connected to one
    if (inVoiceRoom && inVoiceRoom !== channelId) {
      setPendingSwitchChannelId(channelId);
      return;
    }

    // Two-Click workflow:
    // Click 1: If not connected to this room, join audio in background without changing active channel view
    if (inVoiceRoom !== channelId) {
      setInVoiceRoom(channelId);
      gateway.updateVoiceState(channelId, isMuted, isDeafened, false);
      showToast('Connected to Voice in background. Click again to view voice stage.');
    } else {
      // Click 2: Already connected, so navigate into the voice lounge stage
      setSelectedChannelId(channelId);
    }
  };

  const confirmSwitchVoiceChannel = (channelId: string) => {
    setInVoiceRoom(channelId);
    gateway.updateVoiceState(channelId, isMuted, isDeafened, false);
    setPendingSwitchChannelId(null);
    showToast('Switched voice channels. Click again to view voice stage.');
  };

  const handleDisconnectVoice = () => {
    if (inVoiceRoom) {
      gateway.updateVoiceState(null, false, false, false);
      setInVoiceRoom(null);
      showToast('Voice channel disconnected');
    }
  };

  // Send message to active channel or active DM (Real API POST)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;

    const content = messageInput.trim();
    setMessageInput('');

    if (selectedBeaconId === 'home') {
      // Local DM simulation with E2EE double-ratchet indicator
      const now = new Date();
      const newMsg: Message = {
        id: `dm-${Date.now()}`,
        author: currentUser.name,
        callsign: currentUser.callsign,
        discriminator: currentUser.discriminator || '0001',
        avatar: currentUser.avatar,
        content,
        timestamp: 'Today at ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestampMs: now.getTime(),
        roleColor: '#00f0ff',
        staffRank: currentUser.staffRank,
        isEdited: false,
      };
      setChannelMessages(prev => ({
        ...prev,
        [selectedDmId]: [...(prev[selectedDmId] || []), newMsg],
      }));
      return;
    }

    // Real API dispatch for server channels
    try {
      const tx = await api.sendTransmission(selectedChannelId, content);
      const authorObj = tx.author || (tx as any).authorProfile;
      const createdDate = new Date(tx.createdAt || Date.now());
      const newMsg: Message = {
        id: tx.id,
        author: authorObj?.displayName || currentUser.name,
        callsign: authorObj?.username || currentUser.callsign,
        discriminator: authorObj?.discriminator || currentUser.discriminator || '0001',
        avatar: authorObj?.avatarUrl || currentUser.avatar,
        content: tx.content,
        timestamp: 'Today at ' + createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestampMs: createdDate.getTime(),
        roleColor: authorObj?.displayColor || (currentUser as any).displayColor || '#00f0ff',
        staffRank: authorObj?.staffRank ?? currentUser.staffRank,
        roleBadge: (authorObj?.staffRank ?? currentUser.staffRank ?? 0) >= 2 ? 'COMMAND STAFF' : undefined,
        isEdited: false,
      };
      setChannelMessages(prev => ({
        ...prev,
        [selectedChannelId]: [...(prev[selectedChannelId] || []), newMsg],
      }));
    } catch (err: any) {
      showToast(`Failed to dispatch transmission: ${err.message}`);
    }
  };

  const handleStartEdit = (message: Message) => {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleSaveEdit = async (messageId: string) => {
    if (!editingContent.trim()) {
      showToast('Transmission content cannot be empty');
      return;
    }

    const trimmed = editingContent.trim();
    const targetKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;

    try {
      if (selectedBeaconId !== 'home') {
        await api.updateTransmission(messageId, trimmed);
      }

      setChannelMessages(prev => {
        const list = prev[targetKey] || [];
        return {
          ...prev,
          [targetKey]: list.map(m => {
            if (m.id !== messageId) return m;
            return {
              ...m,
              content: trimmed,
              isEdited: true,
              editedAt: new Date().toISOString(),
            };
          }),
        };
      });

      setEditingMessageId(null);
      setEditingContent('');
      showToast('Transmission updated');
    } catch (err: any) {
      showToast(`Failed to update transmission: ${err.message}`);
    }
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

  const handleDeleteMessage = async (messageId: string) => {
    const targetKey = selectedBeaconId === 'home' ? selectedDmId : selectedChannelId;
    if (selectedBeaconId !== 'home') {
      try {
        await api.deleteTransmission(messageId);
      } catch (err) {
        console.warn('Delete transmission warning:', err);
      }
    }
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
      icon: <Users className="w-3.5 h-3.5 text-[#5865f2]" />,
      onClick: () => setIsInviteModalOpen(true),
    },
    {
      label: 'Server Settings',
      icon: <Settings className="w-3.5 h-3.5" />,
      onClick: () => setIsServerSettingsOpen(true),
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

  const getMessageContextMenu = (message: Message): ContextMenuItem[] => {
    const isAuthor = message.callsign === currentUser.callsign || message.author === currentUser.name;
    return [
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
      ...(isAuthor ? [
        {
          label: 'Edit Message',
          icon: <Pencil className="w-3.5 h-3.5 text-[#dbdee1]" />,
          onClick: () => handleStartEdit(message),
        },
      ] : []),
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
      {
        label: 'Report Transmission (Incident Flare)',
        danger: true,
        icon: <ShieldAlert className="w-3.5 h-3.5 text-[#f23f43]" />,
        onClick: () => {
          setIncidentFlareTarget({
            targetType: 'transmission',
            targetId: message.id,
            targetLabel: `Transmission from ${message.author}`,
            snippet: message.content,
          });
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
  };

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
      label: 'Report Transmitter (Incident Flare)',
      danger: true,
      icon: <ShieldAlert className="w-3.5 h-3.5 text-[#f23f43]" />,
      onClick: () => {
        setIncidentFlareTarget({
          targetType: 'transmitter',
          targetId: user.id,
          targetLabel: `@${user.callsign}`,
        });
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

  // Ref for hidden file input to trigger on + click
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const processDirectUpload = async (file: File) => {
    try {
      showToast(`Uploading ${file.name} to Subspace Vault...`);
      const vaultFile = await api.uploadVaultFile(file);
      showToast(`Uploaded ${file.name} to Subspace Vault!`);
      const attachmentTag = `[Attachment: ${file.name} (${(file.size / 1024).toFixed(1)} KB)|${vaultFile.downloadUrl || ''}]`;
      setMessageInput(prev => prev ? `${prev} ${attachmentTag}` : attachmentTag);
    } catch (err: any) {
      if (err.code === 'DISCLAIMER_REQUIRED') {
        setPendingUploadFile(file);
        setIsUploadDisclaimerOpen(true);
        return;
      }
      showToast(`Upload failed: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processDirectUpload(file);
    e.target.value = '';
  };

  const handleDisclaimerAccepted = () => {
    showToast('Vault upload policy acknowledged.');
    if (pendingUploadFile) {
      const f = pendingUploadFile;
      setPendingUploadFile(null);
      processDirectUpload(f);
    }
  };

  const handleTetherCloudSelected = (tether: CloudTetherItem) => {
    const tetherTag = `[CloudTether:${tether.provider}|${tether.title}|${tether.url}|${tether.sizeFormatted}]`;
    setMessageInput(prev => prev ? `${prev} ${tetherTag}` : tetherTag);
    showToast(`Tethered ${tether.title} from ${tether.provider}`);
  };

  const handleAttachmentMenu = (e: React.MouseEvent) => {
    openContextMenu(e, [
      {
        label: 'Upload a File',
        icon: <Plus className="w-3.5 h-3.5" />,
        onClick: () => {
          fileInputRef.current?.click();
        },
      },
      {
        label: 'Open Subspace Vault (File Drive)',
        icon: <HardDrive className="w-3.5 h-3.5 text-[#23a55a]" />,
        onClick: () => {
          setIsSubspaceVaultOpen(true);
        },
      },
      {
        label: 'Tether Cloud File (Drive / Dropbox)',
        icon: <Cloud className="w-3.5 h-3.5 text-[#00f0ff]" />,
        onClick: () => {
          setIsCloudPickerOpen(true);
        },
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

  // Fullscreen Loading Screen on Initial Boot / Refresh
  if (isAppInitializing) {
    return (
      <div 
        className="h-screen w-screen bg-[#080809] flex flex-col items-center justify-center select-none relative overflow-hidden font-sans"
        style={{ fontFamily: currentFontFamily }}
      >
        {/* Subtle background quantum radial gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,240,255,0.08)_0%,transparent_70%)] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col items-center">
          {/* Pulsing Quantum Icon */}
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-3xl bg-[#111214] border border-[#1f2024] flex items-center justify-center text-[#00f0ff] shadow-[0_0_40px_rgba(0,240,255,0.25)] animate-pulse">
              <Radio className="w-10 h-10" />
            </div>
            <div className="absolute -inset-1 rounded-3xl border border-[#00f0ff]/30 animate-ping opacity-25" />
          </div>

          {/* Title */}
          <h1 className="text-white text-xl font-black tracking-[0.3em] uppercase font-mono mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00f0ff] animate-ping" />
            Subspace Frequency
          </h1>

          {/* Animated Status Telemetry */}
          <p className="text-[#80848e] text-xs font-mono tracking-wider flex items-center gap-2">
            Synchronizing Quantum Subspace Telemetry...
          </p>

          {/* Progress bar */}
          <div className="w-48 h-1 bg-[#16171a] rounded-full mt-5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#00f0ff] to-[#5865f2] rounded-full animate-[pulse_1.5s_ease-in-out_infinite]" style={{ width: '80%' }} />
          </div>
        </div>

        {/* Bottom Terminal Hash */}
        <div className="absolute bottom-6 text-[10px] text-[#4e5058] font-mono tracking-widest uppercase">
          PROTOCOL V2.4 • ENCRYPTION: QUANTUM DOUBLE RATCHET • STATUS: SECURE
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex flex-col h-screen w-screen bg-[#000000] text-[#dbdee1] select-none overflow-hidden"
      style={{ fontFamily: currentFontFamily }}
      onClick={() => {
        if (hoverUserPopout) setHoverUserPopout(null);
        if (isUserPopoutOpen) setIsUserPopoutOpen(false);
        if (isServerMenuOpen) setIsServerMenuOpen(false);
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
        {/* Left Combined Dual-Column Container: Server Rail (72px) + Channel Sidebar (channelSidebarWidth) + Full Spanning User Island */}
        <div
          style={{ width: `${72 + channelSidebarWidth}px` }}
          className="flex flex-col shrink-0 h-full relative select-none border-r border-[#1a1b1e] bg-[#080809] z-20"
        >
          {/* Top Section: Server Rail + Active Sidebar */}
          <div className="flex flex-1 min-h-0 w-full">
            {/* 2. Server Rail (Far Left) - Discord Authentic 72px - Jet Black (#080809) */}
            <div className="w-[72px] bg-[#080809] flex flex-col items-center py-3 gap-2 shrink-0 select-none border-r border-[#141518]">
          {/* Subspace Gateway / Home DM Button */}
          <div className="relative flex items-center justify-center w-full group">
            <span 
              className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all duration-200 z-40 ${
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
                  : 'rounded-[24px] hover:rounded-[16px] bg-[#16171a] text-[#dbdee1] hover:bg-[#00f0ff] hover:text-[#07090e]'
              }`}
              title="Direct Messages & Friends"
            >
              <Radio className="w-6 h-6" />
            </button>
          </div>

          <div className="w-8 h-[2px] bg-[#1f2024] rounded-[1px] my-1" />

          {/* Servers / Beacons List (Supports Drag-and-Drop Reordering and Folders!) */}
          <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto scrollbar-none">
            {/* Folder Clusters */}
            {serverFolders.map((folder) => {
              const folderBeacons = beacons.filter(b => folder.beaconIds.includes(b.id));
              const hasActiveInFolder = folder.beaconIds.includes(selectedBeaconId);
              return (
                <div key={folder.id} className="w-full flex flex-col items-center gap-1.5">
                  <div
                    onClick={() => {
                      setServerFolders(prev => prev.map(f => f.id === folder.id ? { ...f, isExpanded: !f.isExpanded } : f));
                    }}
                    className={`w-12 h-12 rounded-[18px] bg-[#16171a] hover:bg-[#202226] flex flex-wrap items-center justify-center p-1.5 gap-1 cursor-pointer transition-all border ${
                      hasActiveInFolder ? 'border-[#00f0ff]' : 'border-[#1f2024]'
                    }`}
                    title={folder.name}
                  >
                    {folderBeacons.slice(0, 4).map((fb) => (
                      <span
                        key={fb.id}
                        style={{ background: fb.gradient }}
                        className="w-4 h-4 rounded-[4px] text-[8px] font-bold text-white flex items-center justify-center"
                      >
                        {fb.iconText[0]}
                      </span>
                    ))}
                  </div>

                  {/* Expanded Folder Children */}
                  {folder.isExpanded && (
                    <div className="w-full bg-[#111214] py-2 rounded-[20px] flex flex-col items-center gap-2 border border-[#1f2024]">
                      {folderBeacons.map((beacon) => {
                        const isSelected = selectedBeaconId === beacon.id;
                        return (
                          <div key={beacon.id} className="relative flex items-center justify-center w-full group">
                            <span 
                              className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all duration-200 z-40 ${
                                isSelected ? 'h-10' : 'h-0 group-hover:h-5'
                              }`} 
                            />
                            <button
                              onClick={() => handleSelectServer(beacon.id)}
                              onContextMenu={(e) => openContextMenu(e, getBeaconContextMenu(beacon))}
                              style={{ background: isSelected ? beacon.gradient : undefined }}
                              className={`w-10 h-10 flex items-center justify-center font-bold text-xs transition-all duration-200 relative ${
                                isSelected 
                                  ? 'rounded-[14px] text-white shadow-lg' 
                                  : 'rounded-[20px] hover:rounded-[14px] bg-[#1c1d22] text-[#dbdee1] hover:bg-[#5865f2] hover:text-white'
                              }`}
                            >
                              {beacon.iconText}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Standalone Server Items */}
            {(() => {
              const clusteredIds = new Set(serverFolders.flatMap(f => f.beaconIds));
              const orderedList = serverOrder.length > 0 
                ? serverOrder.map(id => beacons.find(b => b.id === id)).filter(Boolean) as Beacon[]
                : beacons;
              const standaloneBeacons = orderedList.filter(b => !clusteredIds.has(b.id));

              return standaloneBeacons.map((beacon) => {
                const isSelected = selectedBeaconId === beacon.id;
                const isDragTarget = dragOverTargetId === beacon.id;
                return (
                  <div 
                    key={beacon.id} 
                    className="relative flex items-center justify-center w-full group"
                    draggable
                    onDragStart={(e) => handleServerDragStart(e, beacon.id)}
                    onDragOver={(e) => handleServerDragOver(e, beacon.id)}
                    onDragLeave={() => setDragOverTargetId(null)}
                    onDrop={(e) => handleServerDrop(e, beacon.id)}
                  >
                    {/* White Indicator Pill - Positioned strictly flush against the outer railing (left: 0) */}
                    <span 
                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all duration-200 z-40 ${
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
                        isDragTarget ? 'ring-2 ring-[#00f0ff] scale-105' : ''
                      } ${
                        isSelected 
                          ? 'rounded-[16px] text-white shadow-lg' 
                          : 'rounded-[24px] hover:rounded-[16px] bg-[#16171a] text-[#dbdee1] hover:bg-[#5865f2] hover:text-white'
                      }`}
                    >
                      {beacon.iconText}
                      {/* Unread Indicator Badge: Located at Bottom-Right to avoid top clipping! */}
                      {beacon.unreadCount && beacon.unreadCount > 0 && (
                        <span className="absolute -bottom-1 -right-1 bg-[#f23f43] text-white text-[10px] font-bold h-5 min-w-[20px] px-1 rounded-full flex items-center justify-center border-[3px] border-[#080809] z-20 pointer-events-none shadow-md">
                          {beacon.unreadCount}
                        </span>
                      )}
                    </button>
                  </div>
                );
              });
            })()}

            {/* Add Server & Discovery Buttons */}
            <div className="relative flex items-center justify-center w-full group mt-1">
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full h-0 group-hover:h-5 transition-all z-40" />
              <button
                onClick={() => setIsCreateServerOpen(true)}
                className="w-12 h-12 rounded-[24px] hover:rounded-[16px] bg-[#16171a] hover:bg-[#23a55a] text-[#23a55a] hover:text-white flex items-center justify-center transition-all duration-200"
                title="Add a Server"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <div className="relative flex items-center justify-center w-full group">
              <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all duration-200 z-40 ${
                selectedBeaconId === 'explore' ? 'h-10' : 'h-0 group-hover:h-5'
              }`} />
              <button
                onClick={() => setSelectedBeaconId('explore')}
                className={`w-12 h-12 flex items-center justify-center transition-all duration-200 ${
                  selectedBeaconId === 'explore'
                    ? 'rounded-[16px] bg-[#23a55a] text-white shadow-lg'
                    : 'rounded-[24px] hover:rounded-[16px] bg-[#16171a] hover:bg-[#23a55a] text-[#23a55a] hover:text-white'
                }`}
                title="Explore Discoverable Servers"
              >
                <Compass className="w-5 h-5" />
              </button>
            </div>
            </div>
          </div>

          {/* 3. Secondary Sidebar (Channels or DMs) */}
            <div className="flex-1 min-w-0 bg-[#0f1012] flex flex-col h-full relative overflow-hidden">
              {selectedBeaconId === 'home' ? (
                /* A. Direct Messages & Friends Sidebar (Home View - Jet Black #0f1012) */
                <div className="flex-1 flex flex-col h-full relative">
                  {/* Top Search Button: "Find or start a conversation" */}
                  <div className="h-12 px-2.5 border-b border-[#1a1b1e] flex items-center">
                    <button
                      onClick={() => setIsQuickScanOpen(true)}
                      className="w-full bg-[#08080a] hover:bg-[#16171a] text-[#949ba4] text-xs px-2 py-1.5 rounded-[4px] flex items-center justify-between transition-colors shadow-inner border border-[#1f2024]"
                    >
                      <span className="truncate">Find or start a conversation</span>
                <kbd className="text-[10px] font-mono bg-[#16171a] px-1 rounded text-[#80848e]">Ctrl+K</kbd>
              </button>
            </div>

            {/* Home Navigation (Friends) */}
            <div className="px-2 pt-3 pb-1 space-y-0.5">
              <button
                onClick={() => setSelectedDmId('friends')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-[6px] text-sm font-medium transition-colors ${
                  selectedDmId === 'friends'
                    ? 'bg-[#1a1b1e] text-white font-semibold'
                    : 'text-[#949ba4] hover:bg-[#16171a] hover:text-[#dbdee1]'
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
                <button 
                  type="button"
                  className="hover:text-white cursor-pointer" 
                  title="Create DM" 
                  onClick={() => showToast('Start a new direct conversation')}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-0.5 mt-1">
                {directConversations.map((dm) => {
                  const isSelected = selectedDmId === dm.id;
                  return (
                    <div
                      key={dm.id}
                      onClick={() => setSelectedDmId(dm.id)}
                      onContextMenu={(e) => openContextMenu(e, getUserContextMenu(dm.user))}
                      className={`group flex items-center justify-between px-2 py-2 rounded-[6px] cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#1a1b1e] text-white'
                          : 'text-[#949ba4] hover:bg-[#16171a] hover:text-[#dbdee1]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-8 h-8 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-sm">
                            {dm.user.avatar}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0f1012] ${getStatusColor(dm.user.status)}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span>{dm.user.name}</span>
                            <span title="Quantum E2EE"><Lock className="w-3 h-3 text-[#23a55a] shrink-0" /></span>
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

                </div>
              ) : (
                /* B. Server Channels Sidebar (Jet Black #0f1012) */
                <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                  {/* Server Fixed Header with Anchored Dropdown Menu */}
                  <div className="relative">
              <div 
                onClick={() => setIsServerMenuOpen(p => !p)}
                className="h-12 px-4 border-b border-[#1a1b1e] flex items-center justify-between font-bold text-white shadow-sm hover:bg-[#16171a] cursor-pointer transition-colors"
              >
                <span className="truncate text-sm">{currentServer.name}</span>
                <ChevronDown className={`w-4 h-4 text-[#949ba4] transition-transform ${isServerMenuOpen ? 'rotate-180 text-white' : ''}`} />
              </div>

              {/* Anchored Server Dropdown Menu (Directly Below Header, matching media_1788736046847.png) */}
              {isServerMenuOpen && (
                <div 
                  className="absolute top-13 left-2 right-2 z-50 bg-[#08080a] border border-[#1f2024] rounded-[8px] shadow-[0_16px_36px_rgba(0,0,0,0.9)] p-1.5 space-y-0.5 text-xs animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      showToast(`Boosted ${currentServer.name}!`);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#eb459e] hover:bg-[#eb459e]/10 font-semibold transition-colors"
                  >
                    <span>Server Boost</span>
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      setIsInviteModalOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#5865f2] hover:bg-[#5865f2]/10 font-semibold transition-colors"
                  >
                    <span>Invite to Server</span>
                    <UserPlus className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-[1px] bg-[#1a1b1e] my-1" />

                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      setIsServerSettingsOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Server Settings</span>
                    <Settings className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      showToast('Server Insights telemetry');
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Server Insights</span>
                    <Activity className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      setIsCreateChannelOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Create Channel</span>
                    <Plus className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      setIsCreateCategoryOpen(true);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Create Category</span>
                    <FolderPlus className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>
                  {((currentUser.staffRank ?? 0) > 0) && (
                    <button
                      onClick={() => {
                        setIsServerMenuOpen(false);
                        setIsCommandConsoleOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#00f0ff] hover:bg-[#00f0ff]/10 font-semibold transition-colors"
                    >
                      <span>Command Console</span>
                      <Terminal className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      showToast('Notification Settings');
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Notification Settings</span>
                    <Bell className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>
                  <button
                    onClick={() => {
                      setIsServerMenuOpen(false);
                      showToast('Privacy & Safety Settings');
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Privacy Settings</span>
                    <Shield className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>

                  <div className="h-[1px] bg-[#1a1b1e] my-1" />

                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(selectedBeaconId);
                      setIsServerMenuOpen(false);
                      showToast(`Copied Server ID: ${selectedBeaconId}`);
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[#dbdee1] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  >
                    <span>Copy Server ID</span>
                    <Copy className="w-3.5 h-3.5 text-[#949ba4]" />
                  </button>
                </div>
              )}
            </div>

            {/* Channels & Roles / Browse Channels Header Item */}
            <div className="px-2 pt-3 pb-1">
              <button
                onClick={() => setSelectedChannelId('browse-channels')}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-sm font-medium transition-colors ${
                  selectedChannelId === 'browse-channels'
                    ? 'bg-[#1a1b1e] text-white font-semibold'
                    : 'text-[#949ba4] hover:bg-[#16171a] hover:text-[#dbdee1]'
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
                const isCategoryDragOver = dragOverCategoryId === cat.id;

                return (
                  <div
                    key={cat.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedCategoryId && draggedCategoryId !== cat.id) {
                        setDragOverCategoryId(cat.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverCategoryId === cat.id) setDragOverCategoryId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedCategoryId) {
                        handleCategoryDrop(cat.id);
                      }
                    }}
                    className={`rounded transition-colors ${
                      isCategoryDragOver ? 'bg-[#00f0ff]/10 border-t-2 border-[#00f0ff]' : ''
                    }`}
                  >
                    {/* Category Header (Draggable) */}
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', cat.id);
                        setDraggedCategoryId(cat.id);
                      }}
                      onDragEnd={() => {
                        setDraggedCategoryId(null);
                        setDragOverCategoryId(null);
                      }}
                      onClick={() => setCollapsedCategories(p => ({ ...p, [cat.id]: !p[cat.id] }))}
                      className="flex items-center justify-between text-[11px] font-bold tracking-wider text-[#949ba4] uppercase px-1 py-1 hover:text-white cursor-grab active:cursor-grabbing group"
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        <GripVertical className="w-3 h-3 text-[#4e5058] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        {isCollapsed ? (
                          <ChevronRight className="w-3 h-3 text-[#949ba4] shrink-0" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-[#949ba4] shrink-0" />
                        )}
                        <span className="truncate">{cat.name}</span>
                      </div>
                      <Plus 
                        className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity shrink-0" 
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreateChannelCategory(cat.name);
                          setIsCreateChannelOpen(true);
                        }}
                      />
                    </div>

                    {/* Channel Items */}
                    {!isCollapsed && (
                      <div className="space-y-0.5 mt-0.5">
                        {cat.channels.map((chan) => {
                          const isSelected = selectedChannelId === chan.id;
                          const isChannelDragOver = dragOverChannelId === chan.id;
                          const usersInThisVoice = chan.type === 'voice' ? (voiceUsers[chan.id] || []) : [];

                          return (
                            <div
                              key={chan.id}
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                e.dataTransfer.setData('text/plain', chan.id);
                                setDraggedChannelId(chan.id);
                                setDraggedChannelCategoryId(cat.id);
                              }}
                              onDragEnd={() => {
                                setDraggedChannelId(null);
                                setDraggedChannelCategoryId(null);
                                setDragOverChannelId(null);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedChannelId && draggedChannelId !== chan.id) {
                                  setDragOverChannelId(chan.id);
                                }
                              }}
                              onDragLeave={() => {
                                if (dragOverChannelId === chan.id) setDragOverChannelId(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedChannelId) {
                                  handleChannelDrop(chan.id, cat.id);
                                }
                              }}
                              className={`flex flex-col rounded transition-all ${
                                isChannelDragOver ? 'border-t-2 border-[#00f0ff] bg-[#00f0ff]/10' : ''
                              }`}
                            >
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
                                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] text-sm font-medium transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#1a1b1e] text-white font-semibold'
                                    : 'text-[#949ba4] hover:bg-[#16171a] hover:text-[#dbdee1]'
                                }`}
                              >
                                <GripVertical className="w-3 h-3 text-[#4e5058] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing" />
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
                                      className="flex items-center justify-between px-2 py-1 rounded-[4px] hover:bg-[#1a1b1e] cursor-pointer transition-colors group"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div className={`w-6 h-6 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-xs shrink-0 ${u.isSpeaking ? 'ring-2 ring-[#23a55a]' : ''}`}>
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
                                    onClick={() => setIsInviteModalOpen(true)}
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
          </div>
        )}
      </div>
    </div>

    {/* Bottom Section: Dual-Column User Island + Stacked Voice Controls */}
    {/* Spans across both columns (72px + channelSidebarWidth)! */}
    <div className="w-full shrink-0 bg-[#080809] border-t border-[#1a1b1e] p-2 flex flex-col gap-1.5 z-30 relative select-none">
      {/* Stacked Voice Controls (Screenshot 3) */}
      {inVoiceRoom && (
        <div className="bg-[#0f1012] border border-[#1f2024] rounded-[8px] p-2 flex flex-col gap-1.5 text-xs shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#23a55a] animate-pulse shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-[#23a55a] text-xs leading-none">Voice Connected</span>
                <span className="text-[10px] text-[#949ba4] truncate">
                  {allCurrentChannels.find(c => c.id === inVoiceRoom)?.name || 'Comm-Link'} / 128 kbps
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-[#23a55a] font-mono bg-[#23a55a]/10 px-1.5 py-0.5 rounded">RTC 18ms</span>
              <button
                onClick={handleDisconnectVoice}
                className="p-1 rounded hover:bg-[#1a1b1e] text-[#f23f43] hover:text-white transition-colors"
                title="Disconnect"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => showToast('Video stream toggled')}
              className="flex-1 bg-[#16171a] hover:bg-[#202226] py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1 border border-[#1f2024] text-[#dbdee1] hover:text-white transition-colors"
            >
              <Video className="w-3.5 h-3.5" /> Video
            </button>
            <button
              onClick={() => showToast('Screen share toggled')}
              className="flex-1 bg-[#16171a] hover:bg-[#202226] py-1 rounded text-[11px] font-medium flex items-center justify-center gap-1 border border-[#1f2024] text-[#dbdee1] hover:text-white transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" /> Share Screen
            </button>
          </div>
        </div>
      )}

      {/* Floating User Display Island spanning the full width! */}
      <div className="p-1.5 rounded-[8px] bg-[#111214] border border-[#1f2024] shadow-lg flex items-center justify-between relative">
        <div
          ref={userIslandTriggerRef}
          onClick={() => setIsUserPopoutOpen(p => !p)}
          className="flex items-center gap-2.5 p-1 rounded-[6px] hover:bg-[#1a1b1e] cursor-pointer min-w-0 flex-1 transition-colors"
        >
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-full bg-[#000000] border border-[#2b2d33] flex items-center justify-center text-base">
              {currentUser.avatar}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111214] ${getStatusColor(currentUser.status)}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
              <span>{currentUser.name}</span>
              <span className="text-[10px] text-[#949ba4] font-normal">#{currentUser.discriminator || '0001'}</span>
            </div>
            <div className="text-[10px] text-[#949ba4] truncate">{currentUser.statusText}</div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 text-[#b5bac1]">
          <button
            onClick={() => setIsMuted(p => !p)}
            className={`p-1.5 rounded-[4px] hover:bg-[#1a1b1e] ${isMuted ? 'text-[#f23f43]' : 'hover:text-white'}`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsDeafened(p => !p)}
            className={`p-1.5 rounded-[4px] hover:bg-[#1a1b1e] ${isDeafened ? 'text-[#f23f43]' : 'hover:text-white'}`}
            title={isDeafened ? 'Undeafen' : 'Deafen'}
          >
            <Headphones className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 rounded-[4px] hover:bg-[#1a1b1e] hover:text-white"
            title="User Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* User Island Popout */}
        {isUserPopoutOpen && (
          <div 
            ref={userPopoutRef} 
            className="absolute bottom-[56px] left-2 z-50"
            onClick={(e) => e.stopPropagation()}
          >
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

    {/* Draggable Divider Handle on the right edge */}
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        setIsResizingChannelSidebar(true);
      }}
      className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#00f0ff] transition-colors z-30"
    />
  </div>

        {/* 4. Main Viewport Area */}
        {selectedBeaconId === 'explore' ? (
          /* Explore Public Beacons View - Jet Black */
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full overflow-y-auto p-8 select-none">
            <div className="max-w-4xl mx-auto w-full space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Compass className="w-7 h-7 text-[#00f0ff]" />
                  <span>Discover Subspace Beacons</span>
                </h1>
                <p className="text-sm text-[#949ba4] mt-1">
                  Connect to public beacons and orbital outposts across the galaxy.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {discoverableBeacons.map((b) => {
                  const isJoined = beacons.some((jb) => jb.id === b.id);
                  return (
                    <div
                      key={b.id}
                      className="p-5 rounded-[12px] bg-[#0b0c0e] border border-[#1f2024] hover:border-[#00f0ff]/50 transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <div
                            style={{ background: getBeaconGradient(b.id) }}
                            className="w-10 h-10 rounded-[12px] flex items-center justify-center font-bold text-white text-sm"
                          >
                            {getBeaconInitials(b.name)}
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white">{b.name}</h3>
                            <span className="text-[11px] text-[#00f0ff] font-mono">Public Outpost</span>
                          </div>
                        </div>
                        <p className="text-xs text-[#949ba4] line-clamp-2">
                          {b.description || 'No description provided.'}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#1f2024] flex items-center justify-between">
                        <span className="text-[11px] font-mono text-[#80848e]">{b.id.slice(0, 8)}</span>
                        {isJoined ? (
                          <button
                            onClick={() => setSelectedBeaconId(b.id)}
                            className="bg-[#16171a] text-white px-3 py-1.5 rounded-[4px] text-xs font-semibold hover:bg-[#202226] transition-colors border border-[#2b2d33]"
                          >
                            Enter Beacon
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              try {
                                await api.joinBeacon(b.id);
                                const joined = await api.getJoinedBeacons();
                                setBeacons(joined.map(jb => ({
                                  id: jb.id,
                                  name: jb.name,
                                  iconText: getBeaconInitials(jb.name),
                                  gradient: getBeaconGradient(jb.id),
                                })));
                                setSelectedBeaconId(b.id);
                                showToast(`Joined ${b.name}!`);
                              } catch (err: any) {
                                showToast(`Failed to join: ${err.message}`);
                              }
                            }}
                            className="bg-[#23a55a] text-white px-3 py-1.5 rounded-[4px] text-xs font-semibold hover:bg-[#1f934f] transition-colors"
                          >
                            Join Beacon
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : selectedBeaconId === 'home' && selectedDmId === 'friends' ? (
          /* A. Friends List View - Jet Black */
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full select-none">
            {/* Top Friends Header Bar */}
            <div className="h-12 px-4 border-b border-[#141518] flex items-center justify-between shrink-0 bg-[#0b0c0e]">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 font-bold text-white text-base">
                  <Users className="w-5 h-5 text-[#80848e]" />
                  <span>Friends</span>
                </div>

                <div className="w-[1px] h-4 bg-[#232428]" />

                {/* Tabs */}
                <div className="flex items-center gap-2 text-sm font-medium">
                  {(['online', 'all', 'pending', 'blocked'] as const).map((tab) => {
                    const count = friendsList.filter(f => tab === 'all' || f.relationship === tab).length;
                    return (
                      <button
                        key={tab}
                        onClick={() => setFriendsTab(tab)}
                        className={`px-2.5 py-1 rounded-[4px] capitalize transition-colors ${
                          friendsTab === tab ? 'bg-[#1a1b1e] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#16171a]'
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
                  <button
                    onClick={() => setIsCreateMeshOpen(true)}
                    className="bg-[#1f2024] hover:bg-[#2b2d31] text-white px-2.5 py-1 rounded-[4px] text-xs font-semibold flex items-center gap-1.5 transition-colors border border-[#35363c]"
                  >
                    <Network className="w-3.5 h-3.5 text-[#00f0ff]" />
                    <span>New Group DM</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Friends Content + Active Now Panel */}
            <div className="flex-1 flex min-h-0">
              {/* Friends List Column */}
              <div className="flex-1 flex flex-col p-6 overflow-y-auto min-w-0">
                <div className="mb-4">
                  <div className="bg-[#0b0c0e] border border-[#1f2024] rounded-[6px] flex items-center px-3 py-2 gap-2 text-sm">
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
                        className="flex items-center justify-between p-2.5 hover:bg-[#0b0c0e] rounded-[8px] border-t border-[#141518] transition-colors group"
                      >
                        <div 
                          className="flex items-center gap-3 cursor-pointer"
                          onClick={(e) => handleOpenUserPopout(e, item.user)}
                        >
                          <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-lg">
                              {item.user.avatar}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#000000] ${getStatusColor(item.user.status)}`} />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-white group-hover:underline flex items-center gap-1.5">
                              <span>{item.user.name}</span>
                              <span className="text-xs text-[#80848e] font-normal">@{item.user.callsign}</span>
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
                            className="w-9 h-9 rounded-full bg-[#111214] hover:bg-[#1a1b1e] border border-[#1f2024] flex items-center justify-center text-[#b5bac1] hover:text-white transition-colors"
                            title="Message"
                          >
                            <MessageCircle className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => openContextMenu(e, getUserContextMenu(item.user))}
                            className="w-9 h-9 rounded-full bg-[#111214] hover:bg-[#1a1b1e] border border-[#1f2024] flex items-center justify-center text-[#b5bac1] hover:text-white transition-colors"
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
              <div className="w-80 border-l border-[#141518] p-4 hidden lg:flex flex-col shrink-0 bg-[#080809]">
                <h3 className="text-xl font-bold text-white mb-4">Active Now</h3>
                <div className="space-y-3">
                  <div className="p-3 rounded-[8px] bg-[#0b0c0e] border border-[#1f2024] space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#000000] border border-[#2b2d33] flex items-center justify-center text-sm">
                        👨‍🚀
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">Fleet Admiral Vance</div>
                        <div className="text-[10px] text-[#00f0ff] font-medium">Bridge Comm-Link [Alpha]</div>
                      </div>
                    </div>
                    <p className="text-xs text-[#949ba4]">Connected to orbital tactical array for 1h 24m.</p>
                  </div>

                  <div className="p-3 rounded-[8px] bg-[#0b0c0e] border border-[#1f2024] space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#000000] border border-[#2b2d33] flex items-center justify-center text-sm">
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
          /* B. Direct Message Conversation (With Quantum Double Ratchet E2EE! - Jet Black) */
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full">
            {/* Top DM Header Bar */}
            <div className="h-12 px-4 border-b border-[#141518] flex items-center justify-between shrink-0 bg-[#0b0c0e] shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-xs">
                    {activeDm.user.avatar}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0b0c0e] ${getStatusColor(activeDm.user.status)}`} />
                </div>
                <span className="font-bold text-white text-base truncate">{activeDm.user.name}</span>
                <span className="text-xs text-[#80848e] truncate hidden sm:inline">@{activeDm.user.callsign}</span>
              </div>

              <div className="flex items-center gap-3 text-[#b5bac1]">
                <button onClick={() => showToast(`Starting voice call with ${activeDm.user.name}`)} className="p-1 hover:text-white" title="Start Voice Call">
                  <Phone className="w-5 h-5" />
                </button>
                <button onClick={() => showToast(`Starting video call with ${activeDm.user.name}`)} className="p-1 hover:text-white" title="Start Video Call">
                  <Video className="w-5 h-5" />
                </button>
                <button onClick={() => setIsPinnedPopdownOpen(p => !p)} className="p-1 hover:text-white relative" title="Pinned Messages">
                  <Pin className="w-5 h-5" />
                </button>
                <PinnedMessagesPopdown
                  isOpen={isPinnedPopdownOpen}
                  onClose={() => setIsPinnedPopdownOpen(false)}
                  pinnedMessages={activeMessages.filter(m => m.isPinned).map(m => ({
                    id: m.id,
                    author: m.author,
                    avatar: m.avatar,
                    content: m.content,
                    timestamp: m.timestamp,
                  }))}
                  onUnpin={(id) => handleTogglePin(id)}
                />
                <button onClick={(e) => handleOpenUserPopout(e, activeDm.user)} className="p-1 hover:text-white" title="User Profile">
                  <Shield className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quantum Double Ratchet E2EE Verified Security Banner (Strictly in DMs!) */}
            <div className="bg-[#0b0c0e] border-b border-[#141518] px-4 py-2 flex items-center justify-between text-xs text-[#23a55a]">
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
                <div className="w-16 h-16 rounded-full bg-[#0b0c0e] border border-[#1f2024] flex items-center justify-center text-3xl mb-2">
                  {activeDm.user.avatar}
                </div>
                <h2 className="text-2xl font-bold text-white">{activeDm.user.name}</h2>
                <p className="text-sm text-[#949ba4] mt-1">
                  This is the start of your direct encrypted transmission history with <span className="text-white font-medium">@{activeDm.user.callsign}</span>.
                </p>
              </div>

              {/* Messages list */}
              <div className="space-y-0.5">
                {activeMessages.map((m, idx) => {
                  const prevMsg = idx > 0 ? activeMessages[idx - 1] : undefined;
                  const isGrouped = isGroupedWithPrevious(m, prevMsg);
                  const isSelf = m.callsign === currentUser.callsign || m.author === currentUser.name;

                  return isGrouped ? (
                    /* Grouped Consecutive Message (Within 5 minutes by same sender) */
                    <div
                      key={m.id}
                      data-message-id={m.id}
                      onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                      className="px-4 py-0.5 hover:bg-[#0b0c0e] transition-colors relative group flex items-start gap-4"
                    >
                      <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <MessageActionBar
                          onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                          onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                          onPin={() => handleTogglePin(m.id)}
                          onEdit={isSelf ? () => handleStartEdit(m) : undefined}
                          onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                        />
                      </div>

                      {/* Left Gutter: subtle timestamp on hover instead of avatar */}
                      <div className="w-10 flex items-center justify-end shrink-0 select-none pr-1" style={{ minHeight: '1.375rem' }}>
                        <span className="text-[10px] text-[#80848e] opacity-0 group-hover:opacity-100 font-mono transition-opacity whitespace-nowrap">
                          {m.timestamp.replace(/^(Today at |Yesterday at )/, '')}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {editingMessageId === m.id ? (
                          <div className="w-full mt-0.5">
                            <div className="bg-[#2b2d31] rounded-[8px] p-2.5 border border-[#3f4147] focus-within:border-[#00f0ff] transition-colors">
                              <input
                                type="text"
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSaveEdit(m.id);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    handleCancelEdit();
                                  }
                                }}
                                autoFocus
                                className="w-full bg-transparent text-[#dbdee1] text-[15px] outline-none"
                              />
                            </div>
                            <div className="text-[11px] text-[#949ba4] mt-1.5 flex items-center justify-between">
                              <span>
                                escape to <button type="button" onClick={handleCancelEdit} className="text-[#00f0ff] hover:underline">cancel</button> • enter to <button type="button" onClick={() => handleSaveEdit(m.id)} className="text-[#00f0ff] hover:underline">save</button>
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={handleCancelEdit}
                                  className="px-3 py-1 rounded-[4px] text-xs text-white hover:underline"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(m.id)}
                                  className="px-3 py-1 rounded-[4px] bg-[#5865f2] hover:bg-[#4752c4] text-xs font-semibold text-white transition-colors"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[15px] text-[#dbdee1] leading-[1.375rem] break-words">
                            <MarkdownMessage
                              content={m.content}
                              suffix={
                                m.isEdited ? (
                                  <span
                                    className="text-[10px] text-[#80848e] select-none ml-1.5 font-normal inline"
                                    title={m.editedAt ? `Edited: ${new Date(m.editedAt).toLocaleString()}` : 'Edited'}
                                  >
                                    (edited)
                                  </span>
                                ) : undefined
                              }
                            />
                          </div>
                        )}

                        {m.reactions && m.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {m.reactions.map((r, rIdx) => (
                              <button
                                key={rIdx}
                                onClick={() => handleAddReaction(m.id, r.emoji)}
                                className="rounded-[8px] bg-[#111214] hover:bg-[#1a1b1e] border border-[#1f2024] px-2 py-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1]"
                              >
                                <span>{r.emoji}</span>
                                <span className="font-semibold text-[11px] text-[#dbdee1]">{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Full Header Message Block */
                    <div
                      key={m.id}
                      data-message-id={m.id}
                      onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                      className="px-4 py-1.5 mt-2 hover:bg-[#0b0c0e] transition-colors relative group flex items-start gap-4"
                    >
                      <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <MessageActionBar
                          onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                          onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                          onPin={() => handleTogglePin(m.id)}
                          onEdit={isSelf ? () => handleStartEdit(m) : undefined}
                          onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                        />
                      </div>

                      <div
                        onClick={(e) => handleOpenUserPopout(e, activeDm.user)}
                        className="w-10 h-10 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity mt-0.5"
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
                          <span className="text-[11px] text-[#80848e]">{m.timestamp}</span>
                          {m.isPinned && (
                            <span className="text-[10px] text-[#00f0ff] font-mono flex items-center gap-0.5">
                              <Pin className="w-2.5 h-2.5" /> Pinned
                            </span>
                          )}
                        </div>

                        {editingMessageId === m.id ? (
                          <div className="w-full mt-1">
                            <div className="bg-[#2b2d31] rounded-[8px] p-2.5 border border-[#3f4147] focus-within:border-[#00f0ff] transition-colors">
                              <input
                                type="text"
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSaveEdit(m.id);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    handleCancelEdit();
                                  }
                                }}
                                autoFocus
                                className="w-full bg-transparent text-[#dbdee1] text-[15px] outline-none"
                              />
                            </div>
                            <div className="text-[11px] text-[#949ba4] mt-1.5 flex items-center justify-between">
                              <span>
                                escape to <button type="button" onClick={handleCancelEdit} className="text-[#00f0ff] hover:underline">cancel</button> • enter to <button type="button" onClick={() => handleSaveEdit(m.id)} className="text-[#00f0ff] hover:underline">save</button>
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={handleCancelEdit}
                                  className="px-3 py-1 rounded-[4px] text-xs text-white hover:underline"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(m.id)}
                                  className="px-3 py-1 rounded-[4px] bg-[#5865f2] hover:bg-[#4752c4] text-xs font-semibold text-white transition-colors"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[15px] text-[#dbdee1] leading-[1.375rem] mt-0.5 break-words">
                            <MarkdownMessage
                              content={m.content}
                              suffix={
                                m.isEdited ? (
                                  <span
                                    className="text-[10px] text-[#80848e] select-none ml-1.5 font-normal inline"
                                    title={m.editedAt ? `Edited: ${new Date(m.editedAt).toLocaleString()}` : 'Edited'}
                                  >
                                    (edited)
                                  </span>
                                ) : undefined
                              }
                            />
                          </div>
                        )}

                        {m.reactions && m.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {m.reactions.map((r, rIdx) => (
                              <button
                                key={rIdx}
                                onClick={() => handleAddReaction(m.id, r.emoji)}
                                className="rounded-[8px] bg-[#111214] hover:bg-[#1a1b1e] border border-[#1f2024] px-2 py-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1]"
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

            {/* DM Input Pill */}
            <form onSubmit={handleSendMessage} className="px-4 pb-6 pt-0 bg-[#000000]">
              <div className="bg-[#111214] border border-[#1f2024] rounded-[8px] flex items-center px-4 py-2.5 gap-3 focus-within:border-[#00f0ff]/50 transition-colors">
                <button
                  type="button"
                  onClick={handleAttachmentMenu}
                  className="w-6 h-6 rounded-full bg-[#1f2024] hover:bg-[#2b2d33] text-[#dbdee1] flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
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

                <div className="flex items-center gap-2.5 text-[#80848e]">
                  <button type="button" className="hover:text-white" title="Send a gift">
                    <Gift className="w-5 h-5" />
                  </button>
                  <button type="button" className="hover:text-white text-xs font-bold font-mono px-1 rounded bg-[#1f2024]">
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
          /* C. Browse Channels Area ("Channels & Roles" - Jet Black) */
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full overflow-y-auto select-none">
            {/* Header */}
            <div className="h-12 px-6 border-b border-[#141518] flex items-center justify-between shrink-0 bg-[#0b0c0e]">
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
          /* D. Public Server Channel View (Standard Server Channels - Jet Black #000000 / #0b0c0e) */
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full relative">
            {/* Top Channel Header Bar */}
            <div className="h-12 px-4 border-b border-[#141518] flex items-center justify-between shrink-0 bg-[#0b0c0e] shadow-sm">
              <div className="flex items-center gap-2 min-w-0">
                {getChannelIcon(currentChannel.type)}
                <span className="font-bold text-white text-base truncate">
                  {currentChannel.name}
                </span>
                <div className="w-[1px] h-4 bg-[#232428] mx-2 hidden sm:block" />
                <span className="text-xs text-[#949ba4] truncate hidden sm:inline">
                  {currentChannel.description || `${currentServer.name} channel`}
                </span>
              </div>

              {/* Right Action Icons */}
              <div className="flex items-center gap-2.5 text-[#b5bac1]">
                {/* Voice Text Chat Toggle Button (Only displayed in Voice Channels) */}
                {currentChannel.type === 'voice' && (
                  <button
                    onClick={() => setIsVoiceChatOpen(p => !p)}
                    className={`p-1.5 rounded-[4px] hover:bg-[#1a1b1e] transition-colors ${isVoiceChatOpen ? 'text-white bg-[#1a1b1e]' : 'hover:text-white'}`}
                    title={isVoiceChatOpen ? "Hide Voice Text Chat" : "Show Voice Text Chat"}
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>
                )}

                <button
                  onClick={() => setIsPinnedPopdownOpen(p => !p)}
                  className={`p-1.5 rounded-[4px] hover:bg-[#1a1b1e] transition-colors relative ${isPinnedPopdownOpen ? 'text-white bg-[#1a1b1e]' : 'hover:text-white'}`}
                  title="Pinned Messages"
                >
                  <Pin className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    if (currentChannel.type === 'voice') {
                      setIsVoiceMemberListOpen(p => !p);
                    } else {
                      setIsTextMemberListOpen(p => !p);
                    }
                  }}
                  className={`p-1.5 rounded-[4px] hover:bg-[#1a1b1e] transition-colors ${
                    (currentChannel.type === 'voice' ? isVoiceMemberListOpen : isTextMemberListOpen)
                      ? 'text-white bg-[#1a1b1e]'
                      : 'hover:text-white'
                  }`}
                  title="Member List"
                >
                  <Users className="w-5 h-5" />
                </button>

                {/* Pinned Messages Floating Popdown (Directly Anchored Beneath Pin Button) */}
                <PinnedMessagesPopdown
                  isOpen={isPinnedPopdownOpen}
                  onClose={() => setIsPinnedPopdownOpen(false)}
                  pinnedMessages={activeMessages.filter(m => m.isPinned).map(m => ({
                    id: m.id,
                    author: m.author,
                    avatar: m.avatar,
                    content: m.content,
                    timestamp: m.timestamp,
                  }))}
                  onUnpin={(id) => handleTogglePin(id)}
                />

                {/* Quick Search */}
                <div 
                  onClick={() => setIsQuickScanOpen(true)}
                  className="bg-[#111214] border border-[#1f2024] text-[#949ba4] text-xs px-2.5 py-1 rounded-[4px] flex items-center gap-2 w-36 hover:w-52 transition-all cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-[#80848e]" />
                  <span className="truncate">Search</span>
                  <kbd className="text-[10px] font-mono bg-[#1a1b1e] px-1 rounded ml-auto text-[#80848e]">Ctrl+K</kbd>
                </div>

                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className="p-1.5 rounded-[4px] hover:bg-[#1a1b1e] hover:text-white transition-colors"
                  title="Settings"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Split Voice View or Standard Feed */}
            <div className="flex-1 flex min-h-0 relative">
              {currentChannel.type === 'voice' ? (
                <div className="flex-1 flex flex-col bg-[#000000] p-6 items-center justify-center relative select-none">
                  {/* Voice Grid (1 video/avatar tile per active participant; if alone, 1 user + 1 invite/activity card) */}
                  <div className="grid grid-cols-2 gap-6 max-w-4xl w-full h-full max-h-[500px] items-center">
                    {/* User Tiles */}
                    {(voiceUsers[currentChannel.id] || []).length === 0 ? (
                      <>
                        {/* Connected Self Tile */}
                        <div className="bg-[#1a3328] rounded-[16px] h-full flex flex-col items-center justify-center relative shadow-2xl border border-[#23a55a]/30">
                          <div className="w-24 h-24 rounded-full bg-[#000000] border-2 border-[#23a55a] flex items-center justify-center text-4xl shadow-inner mb-4">
                            {currentUser.avatar}
                          </div>
                          <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-md px-3 py-1 rounded-[6px] text-xs font-semibold text-white">
                            {currentUser.name}
                          </div>
                        </div>

                        {/* Invite / Activity Card matching media_1788737148844.png */}
                        <div className="bg-[#1e1322] rounded-[16px] h-full flex flex-col items-center justify-center relative shadow-2xl border border-[#7928ca]/30 p-6 text-center">
                          <div className="text-5xl mb-4">🏆</div>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => setIsInviteModalOpen(true)}
                              className="bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs font-semibold px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5 text-[#00f0ff]" /> Invite to Voice
                            </button>
                            <button
                              onClick={() => showToast('Activity Launcher')}
                              className="bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs font-semibold px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-[#eb459e]" /> Choose Activity
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (voiceUsers[currentChannel.id] || []).length === 1 ? (
                      <>
                        {/* Single User Tile */}
                        <div className="bg-[#1a3328] rounded-[16px] h-full flex flex-col items-center justify-center relative shadow-2xl border border-[#23a55a]/30">
                          <div className="w-24 h-24 rounded-full bg-[#000000] border-2 border-[#23a55a] flex items-center justify-center text-4xl shadow-inner mb-4">
                            {voiceUsers[currentChannel.id][0].avatar}
                          </div>
                          <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-md px-3 py-1 rounded-[6px] text-xs font-semibold text-white">
                            {voiceUsers[currentChannel.id][0].name}
                          </div>
                        </div>

                        {/* Solo Companion Invite Card */}
                        <div className="bg-[#1e1322] rounded-[16px] h-full flex flex-col items-center justify-center relative shadow-2xl border border-[#7928ca]/30 p-6 text-center">
                          <div className="text-5xl mb-4">🏆</div>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => setIsInviteModalOpen(true)}
                              className="bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs font-semibold px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5 text-[#00f0ff]" /> Invite to Voice
                            </button>
                            <button
                              onClick={() => showToast('Activity Launcher')}
                              className="bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs font-semibold px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-[#eb459e]" /> Choose Activity
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      /* Multi-user tiles: 1 per participant */
                      voiceUsers[currentChannel.id].map(vu => (
                        <div
                          key={vu.id}
                          className={`bg-[#0b0c0e] rounded-[16px] h-full flex flex-col items-center justify-center relative shadow-2xl ${
                            vu.isSpeaking ? 'ring-4 ring-[#23a55a]' : 'border border-[#1f2024]'
                          }`}
                        >
                          <div className="w-20 h-20 rounded-full bg-[#000000] border border-[#2b2d33] flex items-center justify-center text-4xl mb-3 shadow-inner">
                            {vu.avatar}
                          </div>
                          <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-0.5 rounded-[4px] text-xs font-semibold text-white flex items-center gap-1.5">
                            <span>{vu.name}</span>
                            {vu.isSpeaking && <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" />}
                          </div>
                          <div className="absolute bottom-3 right-3 text-[#949ba4]">
                            {vu.isMuted && <MicOff className="w-4 h-4 text-[#f23f43]" />}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Floating Bottom Pill Controls Bar (Replicating media_1788737148844.png) */}
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#111214]/90 backdrop-blur-md border border-[#1f2024] rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl z-20">
                    <button
                      onClick={() => setIsMuted(p => !p)}
                      className={`p-2.5 rounded-full transition-colors ${
                        isMuted ? 'bg-[#f23f43] text-white' : 'bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31]'
                      }`}
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setIsDeafened(p => !p)}
                      className={`p-2.5 rounded-full transition-colors ${
                        isDeafened ? 'bg-[#f23f43] text-white' : 'bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31]'
                      }`}
                      title={isDeafened ? 'Undeafen' : 'Deafen'}
                    >
                      {isDeafened ? <Headphones className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => showToast('Holo-Cast Video Toggled')}
                      className="p-2.5 rounded-full bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31] transition-colors"
                      title="Share Video"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => showToast('Holo-Cast Screen Share Toggled')}
                      className="p-2.5 rounded-full bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31] transition-colors"
                      title="Share Screen"
                    >
                      <Monitor className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => showToast('Opening Activities')}
                      className="p-2.5 rounded-full bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31] transition-colors"
                      title="Activities"
                    >
                      <Sparkles className="w-4 h-4 text-[#eb459e]" />
                    </button>
                    <button
                      onClick={handleDisconnectVoice}
                      className="p-2.5 rounded-full bg-[#f23f43] hover:bg-[#da373b] text-white transition-colors"
                      title="Disconnect"
                    >
                      <PhoneOff className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : currentChannel.type === 'archive' ? (
                <ArchivalForumView
                  relayId={currentChannel.id}
                  relayName={currentChannel.name}
                  currentUser={currentUser}
                  onOpenUserProfile={(u) => handleOpenUserPopout({ clientX: 300, clientY: 200 } as any, u)}
                />
              ) : currentChannel.type === 'gallery' ? (
                <VisualGalleryView
                  relayId={currentChannel.id}
                  relayName={currentChannel.name}
                  currentUser={currentUser}
                  onRequestDisclaimer={(f) => {
                    setPendingUploadFile(f);
                    setIsUploadDisclaimerOpen(true);
                  }}
                />
              ) : (
                /* Standard Messages Feed */
                <div className="flex-1 flex flex-col min-w-0 bg-[#000000]">
                  <div className="flex-1 overflow-y-auto py-4 select-text">
                    {/* Channel Welcome Banner */}
                    <div className="px-4 mb-6">
                      <div className="w-16 h-16 rounded-full bg-[#111214] border border-[#1f2024] flex items-center justify-center text-white mb-2">
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
                        <div className="w-full border-t border-[#1a1b1e]" />
                      </div>
                      <span className="relative bg-[#000000] px-2 text-[12px] font-semibold text-[#80848e]">
                        September 6, 2026
                      </span>
                    </div>

                    {/* Messages */}
                    <div className="space-y-0.5">
                      {activeMessages.map((m, idx) => {
                        const prevMsg = idx > 0 ? activeMessages[idx - 1] : undefined;
                        const isGrouped = isGroupedWithPrevious(m, prevMsg);
                        const isSelf = m.callsign === currentUser.callsign || m.author === currentUser.name;
                        const authorMember = members.find(mem => mem.callsign === m.callsign || mem.name === m.author) || {
                          id: `u-${m.callsign || m.author}`,
                          name: m.author,
                          callsign: m.callsign,
                          discriminator: m.discriminator || '0001',
                          avatar: m.avatar,
                          status: 'online' as const,
                          staffRank: m.staffRank,
                        };

                        return isGrouped ? (
                          /* Grouped Consecutive Message (within 5 minutes by same transmitter) */
                          <div
                            key={m.id}
                            data-message-id={m.id}
                            onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                            className="px-4 py-0.5 hover:bg-[#0b0c0e] transition-colors relative group flex items-start gap-4"
                          >
                            {/* Floating Hover Action Bar */}
                            <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              <MessageActionBar
                                onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                                onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                                onPin={() => handleTogglePin(m.id)}
                                onEdit={isSelf ? () => handleStartEdit(m) : undefined}
                                onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                              />
                            </div>

                            {/* Left Gutter: Compact timestamp on hover instead of avatar */}
                            <div className="w-10 flex items-center justify-end shrink-0 select-none pr-1" style={{ minHeight: '1.375rem' }}>
                              <span className="text-[10px] text-[#80848e] opacity-0 group-hover:opacity-100 font-mono transition-opacity whitespace-nowrap">
                                {m.timestamp.replace(/^(Today at |Yesterday at )/, '')}
                              </span>
                            </div>

                            {/* Message Body & Edit Field */}
                            <div className="flex-1 min-w-0">
                              {editingMessageId === m.id ? (
                                <div className="w-full mt-0.5">
                                  <div className="bg-[#2b2d31] rounded-[8px] p-2.5 border border-[#3f4147] focus-within:border-[#00f0ff] transition-colors">
                                    <input
                                      type="text"
                                      value={editingContent}
                                      onChange={(e) => setEditingContent(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                          e.preventDefault();
                                          handleSaveEdit(m.id);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          handleCancelEdit();
                                        }
                                      }}
                                      autoFocus
                                      className="w-full bg-transparent text-[#dbdee1] text-[15px] outline-none"
                                    />
                                  </div>
                                  <div className="text-[11px] text-[#949ba4] mt-1.5 flex items-center justify-between">
                                    <span>
                                      escape to <button type="button" onClick={handleCancelEdit} className="text-[#00f0ff] hover:underline">cancel</button> • enter to <button type="button" onClick={() => handleSaveEdit(m.id)} className="text-[#00f0ff] hover:underline">save</button>
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={handleCancelEdit}
                                        className="px-3 py-1 rounded-[4px] text-xs text-white hover:underline"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSaveEdit(m.id)}
                                        className="px-3 py-1 rounded-[4px] bg-[#5865f2] hover:bg-[#4752c4] text-xs font-semibold text-white transition-colors"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[15px] text-[#dbdee1] leading-[1.375rem] break-words">
                                  <MarkdownMessage
                                    content={m.content}
                                    suffix={
                                      m.isEdited ? (
                                        <span
                                          className="text-[10px] text-[#80848e] select-none ml-1.5 font-normal inline"
                                          title={m.editedAt ? `Edited: ${new Date(m.editedAt).toLocaleString()}` : 'Edited'}
                                        >
                                          (edited)
                                        </span>
                                      ) : undefined
                                    }
                                  />
                                </div>
                              )}

                              {/* Reaction Pills */}
                              {m.reactions && m.reactions.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {m.reactions.map((r, rIdx) => (
                                    <button
                                      key={rIdx}
                                      onClick={() => handleAddReaction(m.id, r.emoji)}
                                      className="rounded-[8px] bg-[#111214] hover:bg-[#1a1b1e] border border-[#1f2024] px-2 py-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1] transition-colors"
                                    >
                                      <span>{r.emoji}</span>
                                      <span className="font-semibold text-[11px] text-[#dbdee1]">{r.count}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* Full Header Message Block */
                          <div
                            key={m.id}
                            data-message-id={m.id}
                            onContextMenu={(e) => openContextMenu(e, getMessageContextMenu(m))}
                            className="px-4 py-1.5 mt-2 hover:bg-[#0b0c0e] transition-colors relative group flex items-start gap-4"
                          >
                            {/* Floating Hover Action Bar */}
                            <div className="absolute right-4 -top-3.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                              <MessageActionBar
                                onAddReaction={(emoji) => handleAddReaction(m.id, emoji)}
                                onReply={() => setMessageInput(`> ${m.content}\n@${m.author} `)}
                                onPin={() => handleTogglePin(m.id)}
                                onEdit={isSelf ? () => handleStartEdit(m) : undefined}
                                onMore={(e) => openContextMenu(e, getMessageContextMenu(m))}
                              />
                            </div>

                            {/* Avatar (Opens Hover Popover) */}
                            <div
                              onClick={(e) => handleOpenUserPopout(e, authorMember)}
                              className="w-10 h-10 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity mt-0.5"
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

                                {(m.roleBadge || (authorMember.staffRank && authorMember.staffRank >= 2) || (authorMember.callsign === 'command_officer' || m.callsign === 'command_officer')) && (
                                  <span className="bg-[#5865f2] text-white text-[10px] font-bold px-1 rounded uppercase">
                                    {m.roleBadge || 'COMMAND STAFF'}
                                  </span>
                                )}

                                <span className="text-[11px] text-[#80848e]">{m.timestamp}</span>

                                {m.isPinned && (
                                  <span className="text-[10px] text-[#00f0ff] font-mono flex items-center gap-0.5">
                                    <Pin className="w-2.5 h-2.5" /> Pinned
                                  </span>
                                )}
                              </div>

                              {editingMessageId === m.id ? (
                                <div className="w-full mt-1">
                                  <div className="bg-[#2b2d31] rounded-[8px] p-2.5 border border-[#3f4147] focus-within:border-[#00f0ff] transition-colors">
                                    <input
                                      type="text"
                                      value={editingContent}
                                      onChange={(e) => setEditingContent(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                          e.preventDefault();
                                          handleSaveEdit(m.id);
                                        } else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          handleCancelEdit();
                                        }
                                      }}
                                      autoFocus
                                      className="w-full bg-transparent text-[#dbdee1] text-[15px] outline-none"
                                    />
                                  </div>
                                  <div className="text-[11px] text-[#949ba4] mt-1.5 flex items-center justify-between">
                                    <span>
                                      escape to <button type="button" onClick={handleCancelEdit} className="text-[#00f0ff] hover:underline">cancel</button> • enter to <button type="button" onClick={() => handleSaveEdit(m.id)} className="text-[#00f0ff] hover:underline">save</button>
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={handleCancelEdit}
                                        className="px-3 py-1 rounded-[4px] text-xs text-white hover:underline"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSaveEdit(m.id)}
                                        className="px-3 py-1 rounded-[4px] bg-[#5865f2] hover:bg-[#4752c4] text-xs font-semibold text-white transition-colors"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[15px] text-[#dbdee1] leading-[1.375rem] mt-0.5 break-words">
                                  <MarkdownMessage
                                    content={m.content}
                                    suffix={
                                      m.isEdited ? (
                                        <span
                                          className="text-[10px] text-[#80848e] select-none ml-1.5 font-normal inline"
                                          title={m.editedAt ? `Edited: ${new Date(m.editedAt).toLocaleString()}` : 'Edited'}
                                        >
                                          (edited)
                                        </span>
                                      ) : undefined
                                    }
                                  />
                                </div>
                              )}

                              {/* Reaction Pills */}
                              {m.reactions && m.reactions.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {m.reactions.map((r, rIdx) => (
                                    <button
                                      key={rIdx}
                                      onClick={() => handleAddReaction(m.id, r.emoji)}
                                      className="rounded-[8px] bg-[#111214] hover:bg-[#1a1b1e] border border-[#1f2024] px-2 py-0.5 flex items-center gap-1.5 text-xs text-[#b5bac1] transition-colors"
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

                  {/* Hidden File Picker Input */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {/* Channel Message Input Container (Shown ONLY for standard text channels, NEVER in voice stage!) */}
                  <form onSubmit={handleSendMessage} className="px-4 pb-6 pt-0 bg-[#000000] relative">
                    {/* Emoji Picker Popover */}
                    <EmojiPickerPopdown
                      isOpen={isEmojiPickerOpen}
                      onClose={() => setIsEmojiPickerOpen(false)}
                      customEmojis={beaconEmojisList}
                      onSelectEmoji={(emoji) => {
                        setMessageInput(prev => `${prev}${emoji}`);
                      }}
                    />

                    <div className="bg-[#111214] border border-[#1f2024] rounded-[8px] flex items-center px-4 py-2.5 gap-3 focus-within:border-[#00f0ff]/50 transition-colors">
                      <button
                        type="button"
                        onClick={handleAttachmentMenu}
                        className="w-6 h-6 rounded-full bg-[#1f2024] hover:bg-[#2b2d33] text-[#dbdee1] flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
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

                      <div className="flex items-center gap-2.5 text-[#80848e]">
                        <button type="button" className="hover:text-white text-xs font-bold font-mono px-1.5 py-0.5 rounded bg-[#1f2024] transition-colors" title="Open GIF picker">
                          GIF
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setIsEmojiPickerOpen(p => !p)} 
                          className={`hover:text-white transition-colors ${isEmojiPickerOpen ? 'text-[#00f0ff]' : ''}`} 
                          title="Select Signal Glyph (Emoji)"
                        >
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

              {/* Split Voice Text Chat Flyout (Toggleable in Voice Channels via the Message Icon) */}
              {currentChannel.type === 'voice' && isVoiceChatOpen && (
                <div className="w-80 bg-[#0b0c0e] border-l border-[#1a1b1e] flex flex-col shrink-0 animate-in slide-in-from-right duration-150 select-none">
                  <div className="h-12 px-4 border-b border-[#1a1b1e] flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-[#00f0ff]" />
                      <span>Voice Text Chat</span>
                    </span>
                    <button 
                      onClick={() => setIsVoiceChatOpen(false)}
                      className="p-1 rounded hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text">
                    {(channelMessages[currentChannel.id] || []).length === 0 ? (
                      <div className="text-xs text-[#80848e] text-center mt-8">
                        No messages in this voice channel yet.
                      </div>
                    ) : (
                      (channelMessages[currentChannel.id] || []).map((m) => (
                        <div key={m.id} className="p-2 rounded bg-[#111214] border border-[#1f2024] text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-white">{m.author}</span>
                            <span className="text-[10px] text-[#80848e]">{m.timestamp}</span>
                          </div>
                          <p className="text-[#dbdee1]">{m.content}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleSendMessage} className="p-3 border-t border-[#1a1b1e] bg-[#08080a]">
                    <div className="bg-[#111214] border border-[#1f2024] rounded-[6px] flex items-center px-3 py-1.5 gap-2">
                      <input
                        type="text"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        placeholder="Message in voice chat..."
                        className="bg-transparent flex-1 text-xs text-white outline-none placeholder-[#80848e]"
                      />
                      {messageInput.trim() && (
                        <button type="submit" className="text-[#00f0ff]">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              )}

              {/* 5. Server Member List Sidebar (Jet Black #0f1012) - Resizable with Draggable Handle */}
              {selectedBeaconId !== 'home' && (currentChannel.type === 'voice' ? isVoiceMemberListOpen : isTextMemberListOpen) && (
          <div 
            style={{ width: `${memberPanelWidth}px` }} 
            className="bg-[#0f1012] flex flex-col shrink-0 border-l border-[#1a1b1e] select-none relative"
          >
            {/* Draggable Divider Handle for Member List Resizing */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingMemberPanel(true);
              }}
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-[#00f0ff] transition-colors z-30"
            />

            <div className="flex-1 overflow-y-auto px-2 py-4 space-y-4">
              {/* Fleet Command Role Group */}
              <div>
                <div className="text-[11px] font-bold tracking-wider text-[#949ba4] uppercase px-2 mb-1">
                  Fleet Command — {members.filter(m => m.staffRank && m.staffRank >= 2).length}
                </div>
                <div className="space-y-0.5">
                  {members.filter(m => m.staffRank && m.staffRank >= 2).map((m) => (
                    <div
                      key={m.id}
                      data-member-id={m.id}
                      onClick={(e) => handleOpenUserPopout(e, m)}
                      onContextMenu={(e) => openContextMenu(e, getUserContextMenu(m))}
                      className="px-2 py-1.5 rounded-[6px] hover:bg-[#16171a] cursor-pointer flex items-center gap-2.5 transition-colors group"
                    >
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-sm">
                          {m.avatar}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0f1012] ${getStatusColor(m.status)}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#00f0ff] group-hover:text-white truncate flex items-center gap-1">
                          {m.name}
                        </div>
                        <div className="text-[10px] text-[#80848e] truncate">
                          {m.statusText || `@${m.callsign}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Enlisted Crew Role Group */}
              <div>
                <div className="text-[11px] font-bold tracking-wider text-[#949ba4] uppercase px-2 mb-1">
                  Enlisted Transmitters — {members.filter(m => !m.staffRank || m.staffRank < 2).length}
                </div>
                <div className="space-y-0.5">
                  {members.filter(m => !m.staffRank || m.staffRank < 2).map((m) => (
                    <div
                      key={m.id}
                      onClick={(e) => handleOpenUserPopout(e, m)}
                      onContextMenu={(e) => openContextMenu(e, getUserContextMenu(m))}
                      className="px-2 py-1.5 rounded-[6px] hover:bg-[#16171a] cursor-pointer flex items-center gap-2.5 transition-colors group"
                    >
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-[#000000] border border-[#1f2024] flex items-center justify-center text-sm">
                          {m.avatar}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0f1012] ${getStatusColor(m.status)}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#dbdee1] group-hover:text-white truncate">
                          {m.name}
                        </div>
                        <div className="text-[10px] text-[#80848e] truncate">
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
      </div>
    </div>
  )}
</div>

      {/* 7. Hovering User Profile Popover (Rendered Adjacent to Click Target, NOT Fullscreen Modal!) */}
      {hoverUserPopout && (
        <div 
          ref={hoverUserPopoutRef}
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
            {Object.entries(serverData).flatMap(([bId, srv]) => 
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

      {/* 9. Discord User Settings Modal (Exact same 840x600 fixed dimensions as Server Settings) */}
      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="User Settings"
        fixedDimensions={true}
      >
        <div className="flex gap-6 h-full min-h-0">
          {/* Settings Left Navigation */}
          <div className="w-48 flex flex-col gap-1 border-r border-[#232428] pr-4 shrink-0 text-xs font-medium">
            <div className="text-[10px] uppercase font-bold text-[#949ba4] px-2 py-1">User Settings</div>
            <button
              onClick={() => setActiveSettingsTab('profile')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'profile' ? 'bg-[#35373c] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              My Account & Profile
            </button>
            <button
              onClick={() => setActiveSettingsTab('appearance')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'appearance' ? 'bg-[#35373c] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Appearance & Spectrum
            </button>
            <button
              onClick={() => setActiveSettingsTab('badges')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'badges' ? 'bg-[#35373c] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Commendations & Badges
            </button>
            <button
              onClick={() => setActiveSettingsTab('voice')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'voice' ? 'bg-[#35373c] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Voice & Video
            </button>
            <button
              onClick={() => setActiveSettingsTab('security')}
              className={`text-left px-2 py-1.5 rounded-[4px] transition-colors ${
                activeSettingsTab === 'security' ? 'bg-[#35373c] text-white font-semibold' : 'text-[#b5bac1] hover:bg-[#35373c]/50'
              }`}
            >
              Security & 2FA
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
              <div className="space-y-5 text-xs">
                <div>
                  <h3 className="text-sm font-bold text-white mb-0.5">Transmitter Identity</h3>
                  <p className="text-[#949ba4] text-[11px]">Manage your display name, tag, and personal bio.</p>
                </div>

                <div className="bg-[#111214] border border-[#1f2024] p-3.5 rounded-[8px] space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#949ba4] uppercase">Display Name</label>
                    <input
                      type="text"
                      value={currentUser.name}
                      onChange={(e) => setCurrentUser(p => ({ ...p, name: e.target.value }))}
                      className="w-full bg-[#080809] border border-[#2b2d31] rounded-[6px] px-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#00f0ff]"
                    />
                  </div>

                  <div className="flex justify-between items-center py-1">
                    <span className="text-[#949ba4]">Transmitter Tag</span>
                    <span className="text-white font-mono bg-[#16171a] px-2 py-1 rounded border border-[#232428]">
                      @{currentUser.callsign}#{currentUser.discriminator || '0001'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold text-[#949ba4] uppercase">About Me (Bio)</label>
                      <span className={`text-[10px] ${((currentUser.bio || '').length > 450) ? 'text-[#f23f43]' : 'text-[#80848e]'}`}>
                        {(currentUser.bio || '').length}/500
                      </span>
                    </div>
                    <textarea
                      rows={4}
                      maxLength={500}
                      value={currentUser.bio || ''}
                      onChange={(e) => setCurrentUser(p => ({ ...p, bio: e.target.value }))}
                      placeholder="Share a transmission about yourself (up to 500 characters)..."
                      className="w-full bg-[#080809] border border-[#2b2d31] rounded-[6px] p-2.5 text-white text-xs placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none"
                    />
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.updateProfile({
                            displayName: currentUser.name,
                            bio: currentUser.bio,
                          });
                          showToast('Profile updated and saved!');
                        } catch (err: any) {
                          showToast(`Failed to update profile: ${err.message}`);
                        }
                      }}
                      className="px-4 py-2 rounded-[6px] bg-[#00f0ff] hover:bg-[#33f3ff] text-black font-bold text-xs transition-all shadow-[0_0_12px_rgba(0,240,255,0.3)]"
                    >
                      Save Profile Changes
                    </button>
                  </div>
                </div>

                <div className="bg-[#111214] border border-[#1f2024] p-3 rounded-[8px] space-y-2">
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
                <div className="bg-[#111214] border border-[#1f2024] p-3 rounded-[8px] space-y-2 text-[#dbdee1]">
                  <p>RTC Engine: LiveKit Subspace WebRTC</p>
                  <p>Audio Codec: Opus 128 kbps Quantum Optimized</p>
                  <p>Echo Cancellation & Noise Suppression: Enabled</p>
                </div>
              </div>
            )}

            {activeSettingsTab === 'security' && (
              <div className="space-y-5 text-xs">
                <div>
                  <h3 className="text-sm font-bold text-white mb-0.5">Authentication & Cryptography</h3>
                  <p className="text-[#949ba4] text-[11px]">Manage Two-Factor Authentication, WebAuthn passkeys, and quantum E2EE keys.</p>
                </div>

                {/* 2FA TOTP Card */}
                <div className="bg-[#111214] border border-[#1f2024] p-4 rounded-[8px] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-white text-xs flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#23a55a]" />
                        <span>Two-Factor Authentication (TOTP)</span>
                      </div>
                      <p className="text-[11px] text-[#949ba4] mt-0.5">
                        Require an authenticator code (Google Authenticator, Authy, 1Password) upon login.
                      </p>
                    </div>
                    <button
                      onClick={() => showToast('TOTP 2FA configuration active for account.')}
                      className="bg-[#23a55a] hover:bg-[#1f934f] text-white font-semibold px-3 py-1.5 rounded text-xs transition-colors"
                    >
                      Active
                    </button>
                  </div>

                  <div className="pt-2 border-t border-[#1f2024] flex items-center justify-between text-[11px]">
                    <span className="text-[#80848e]">10 Emergency Backup Recovery Codes available</span>
                    <button
                      onClick={() => showToast('Recovery codes downloaded to secure file.')}
                      className="text-[#00f0ff] hover:underline"
                    >
                      View Backup Codes
                    </button>
                  </div>
                </div>

                {/* WebAuthn / Passkeys */}
                <div className="bg-[#111214] border border-[#1f2024] p-4 rounded-[8px] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-white text-xs">FIDO2 / WebAuthn Passkeys</div>
                      <p className="text-[11px] text-[#949ba4] mt-0.5">
                        Sign in without passwords using hardware security keys, Windows Hello, or Touch ID.
                      </p>
                    </div>
                    <button
                      onClick={() => showToast('Passkey registration prompt dispatched.')}
                      className="bg-[#1f2024] hover:bg-[#2b2d31] text-white font-semibold px-3 py-1.5 rounded text-xs transition-colors border border-[#35363c]"
                    >
                      Register Passkey
                    </button>
                  </div>
                </div>

                {/* Quantum Double Ratchet E2EE Key Info */}
                <div className="bg-[#111214] border border-[#1f2024] p-4 rounded-[8px] space-y-2">
                  <div className="font-bold text-white text-xs">Subspace Quantum Ratchet (QKD-E2EE)</div>
                  <p className="text-[11px] text-[#949ba4]">
                    Point-to-Point direct transmissions are end-to-end encrypted with X25519 & Kyber-1024 hybrid ratchets.
                  </p>
                  <div className="p-2 bg-[#080809] border border-[#1f2024] rounded font-mono text-[11px] text-[#00f0ff]">
                    Local Identity Fingerprint: {currentUser.quantumKeyFingerprint || 'SF-QKD-9821-B07F-11AE'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 10. Invite Friends Modal */}
      <InviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        serverName={currentServer.name}
        channelName={currentChannel.name}
        friends={friendsList}
        inviteCode={`subspace.gg/${currentServer.name.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'orbit'}`}
        onSendInvite={(fId) => showToast(`Invite beacon transmitted to friend (${fId})!`)}
      />

      {/* 11. Dedicated Server Settings Modal */}
      <ServerSettingsModal
        isOpen={isServerSettingsOpen}
        onClose={() => setIsServerSettingsOpen(false)}
        serverName={currentServer.name}
        serverId={selectedBeaconId}
        onUpdateServerName={(newName) => {
          setBeacons(prev => prev.map(b => b.id === selectedBeaconId ? { ...b, name: newName } : b));
          setServerData(prev => ({
            ...prev,
            [selectedBeaconId]: {
              ...prev[selectedBeaconId],
              name: newName,
            },
          }));
          showToast(`Server updated to ${newName}`);
          setIsServerSettingsOpen(false);
        }}
        onDeleteServer={() => {
          showToast(`Cannot delete active fleet station`);
          setIsServerSettingsOpen(false);
        }}
      />

      {/* 12. Create Server / Beacon Modal */}
      <CreateServerModal
        isOpen={isCreateServerOpen}
        onClose={() => setIsCreateServerOpen(false)}
        onCreateServer={async (name: string, description?: string) => {
          try {
            const newBeacon = await api.createBeacon(name, description);
            setBeacons(prev => [...prev, {
              id: newBeacon.id,
              name: newBeacon.name,
              iconText: getBeaconInitials(newBeacon.name),
              gradient: getBeaconGradient(newBeacon.id),
            }]);
            setSelectedBeaconId(newBeacon.id);
            showToast(`Created and tuned into Beacon: ${newBeacon.name}`);
          } catch (err: any) {
            showToast(`Failed to create beacon: ${err.message}`);
          }
        }}
      />

      {/* 13. Create Channel Modal */}
      <CreateChannelModal
        isOpen={isCreateChannelOpen}
        onClose={() => {
          setIsCreateChannelOpen(false);
          setCreateChannelCategory(undefined);
        }}
        categoryName={createChannelCategory}
        onCreateChannel={async (name: string, type: 'text' | 'voice' | 'announcement', topic?: string) => {
          try {
            const newRelay = await api.createRelay(selectedBeaconId, name, type, undefined, topic);
            setServerData(prev => {
              const current = prev[selectedBeaconId] || { name: currentServer.name, categories: [] };
              const updatedCategories = current.categories.map(cat => {
                if (createChannelCategory ? cat.name === createChannelCategory : cat.id === 'cat-text') {
                  return {
                    ...cat,
                    channels: [...cat.channels, {
                      id: newRelay.id,
                      name: newRelay.name,
                      type: newRelay.type as any,
                      description: newRelay.topic || undefined,
                    }],
                  };
                }
                return cat;
              });
              return {
                ...prev,
                [selectedBeaconId]: {
                  ...current,
                  categories: updatedCategories,
                },
              };
            });
            setSelectedChannelId(newRelay.id);
            showToast(`Relay #${newRelay.name} provisioned`);
          } catch (err: any) {
            showToast(`Failed to create relay: ${err.message}`);
          }
        }}
      />

      {/* 14. Create Category Modal */}
      <CreateCategoryModal
        isOpen={isCreateCategoryOpen}
        onClose={() => setIsCreateCategoryOpen(false)}
        onCreateCategory={async (catName: string) => {
          setServerData(prev => {
            const current = prev[selectedBeaconId] || { name: currentServer.name, categories: [] };
            return {
              ...prev,
              [selectedBeaconId]: {
                ...current,
                categories: [
                  ...current.categories,
                  {
                    id: `cat-${Date.now()}`,
                    name: catName,
                    channels: [],
                  },
                ],
              },
            };
          });
          showToast(`Category [${catName}] established`);
        }}
      />

      {/* 15. Subspace Vault Upload Disclaimer Modal */}
      <UploadDisclaimerModal
        isOpen={isUploadDisclaimerOpen}
        onClose={() => {
          setIsUploadDisclaimerOpen(false);
          setPendingUploadFile(null);
        }}
        onAccepted={handleDisclaimerAccepted}
      />

      {/* 16. Cloud Drive Picker Modal (Google Drive, OneDrive, Dropbox) */}
      <CloudDrivePickerModal
        isOpen={isCloudPickerOpen}
        onClose={() => setIsCloudPickerOpen(false)}
        onSelectTether={handleTetherCloudSelected}
      />

      {/* 17. Full Profile Modal */}
      <FullProfileModal
        user={fullProfileUser}
        isOpen={Boolean(fullProfileUser)}
        onClose={() => setFullProfileUser(null)}
      />

      {/* 18. Voice Channel Switch Confirmation Dialog */}
      {pendingSwitchChannelId && (
        <Modal
          isOpen={Boolean(pendingSwitchChannelId)}
          onClose={() => setPendingSwitchChannelId(null)}
          title="Switch Voice Channel?"
        >
          <div className="space-y-4 text-xs">
            <p className="text-[#dbdee1] leading-relaxed">
              You are already connected to a voice channel. Switching will disconnect your current audio session and connect you to the new channel. Do you wish to proceed?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingSwitchChannelId(null)}
                className="px-4 py-2 rounded-[6px] text-xs font-semibold text-[#dbdee1] hover:bg-[#1a1b1e] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmSwitchVoiceChannel(pendingSwitchChannelId)}
                className="px-4 py-2 rounded-[6px] text-xs font-bold text-white bg-[#5865f2] hover:bg-[#4752c4] transition-all shadow-[0_0_12px_rgba(88,101,242,0.4)]"
              >
                Switch Channel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 19. Subspace Vault Personal File Drive Modal */}
      <SubspaceVaultModal
        isOpen={isSubspaceVaultOpen}
        onClose={() => setIsSubspaceVaultOpen(false)}
        onInsertAttachmentTag={(tag) => setMessageInput(prev => prev ? `${prev} ${tag}` : tag)}
        onRequestDisclaimer={(file) => {
          setPendingUploadFile(file);
          setIsUploadDisclaimerOpen(true);
        }}
      />

      {/* 20. Incident Flare Reporting Modal */}
      {incidentFlareTarget && (
        <IncidentFlareModal
          isOpen={Boolean(incidentFlareTarget)}
          onClose={() => setIncidentFlareTarget(null)}
          targetType={incidentFlareTarget.targetType}
          targetId={incidentFlareTarget.targetId}
          targetLabel={incidentFlareTarget.targetLabel}
          snippet={incidentFlareTarget.snippet}
        />
      )}

      {/* 21. Command Console Staff Dashboard Modal */}
      <CommandConsoleModal
        isOpen={isCommandConsoleOpen}
        onClose={() => setIsCommandConsoleOpen(false)}
        staffRank={currentUser.staffRank || 0}
      />

      {/* 22. Subspace Mesh (Group DM) Creation Modal */}
      <CreateMeshModal
        isOpen={isCreateMeshOpen}
        onClose={() => setIsCreateMeshOpen(false)}
        friends={friendsList}
        onMeshCreated={(mesh) => {
          showToast(`Subspace Mesh "${mesh.name}" established.`);
          setSelectedBeaconId('home');
          // Add to direct conversations list
          setDirectConversations(prev => [
            {
              id: mesh.id,
              user: {
                id: mesh.id,
                name: mesh.name,
                callsign: mesh.name.toLowerCase().replace(/\s+/g, '_'),
                discriminator: 'MESH',
                avatar: '🌐',
                status: 'online',
                statusText: `${mesh.memberCount || 2} mesh participants`,
              },
              e2eeFingerprint: `SF-MESH-${mesh.id.slice(0, 4).toUpperCase()}`,
            },
            ...prev,
          ]);
          setSelectedDmId(mesh.id);
        }}
      />
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
