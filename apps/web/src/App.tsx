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
  Image as ImageIcon
} from 'lucide-react';
import { Modal, Button, Input, ColorWheel, FontSelector, BadgeDeck, THEME } from '@subspace/ui';
import { usePlatformEnvironment } from './usePlatformEnvironment';

// Mock types and initial data for high fidelity UI
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

interface Message {
  id: string;
  author: string;
  avatar: string;
  content: string;
  timestamp: string;
  staffRank?: number;
}

export const App: React.FC = () => {
  const platform = usePlatformEnvironment();

  // State
  const [selectedBeaconId, setSelectedBeaconId] = useState('beacon-prime');
  const [selectedChannelId, setSelectedChannelId] = useState('relay-general');
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({ 'cluster-ops': true });
  
  // Modals
  const [isQuickScanOpen, setIsQuickScanOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [quickScanQuery, setQuickScanQuery] = useState('');

  // Settings State
  const [accentColor, setAccentColor] = useState('#00F0FF');
  const [selectedFont, setSelectedFont] = useState('default');
  const [messageInput, setMessageInput] = useState('');

  // Audio / Comm-Link state
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [inVoiceRoom, setInVoiceRoom] = useState(false);

  // Clusters & Beacons
  const clusters: Cluster[] = [
    { id: 'cluster-ops', name: 'Fleet Operations', beaconIds: ['beacon-prime', 'beacon-tactical'] }
  ];

  const beacons: Beacon[] = [
    { id: 'beacon-prime', name: 'Aegis Command Station', unreadCount: 3 },
    { id: 'beacon-tactical', name: 'Vanguard Squadron' },
    { id: 'beacon-deep', name: 'Outer Rim Science Vessel' },
  ];

  const channels: Channel[] = [
    { id: 'relay-announcements', name: 'high-priority-broadcasts', type: 'TEXT_RELAY' },
    { id: 'relay-general', name: 'quantum-transmissions', type: 'TEXT_RELAY' },
    { id: 'relay-archives', name: 'mission-flight-logs', type: 'ARCHIVAL_RELAY' },
    { id: 'relay-visuals', name: 'telemetry-recon-gallery', type: 'VISUAL_RELAY' },
    { id: 'comm-bridge', name: 'Bridge Comm-Link [Alpha]', type: 'COMM_LINK' },
  ];

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      author: 'Fleet Admiral Vance',
      avatar: '👨‍🚀',
      content: 'All subspace arrays report nominal frequency resonance across orbital sector 7.',
      timestamp: '14:22 UTC',
      staffRank: 3,
    },
    {
      id: 'm2',
      author: 'Echo-4 Specialist',
      avatar: '🛰️',
      content: 'Acknowledged. Quantum bitfield clearances synchronized. Vault disclaimer confirmed.',
      timestamp: '14:25 UTC',
      staffRank: 1,
    },
  ]);

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
        avatar: '⚡',
        content: messageInput,
        timestamp: 'Just now',
        staffRank: 2,
      },
    ]);
    setMessageInput('');
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
      {/* 1. Beacon Strip (Far Left) */}
      <div className="w-[72px] bg-[#07090E] flex flex-col items-center py-3 gap-2 border-r border-[#232936] shrink-0 z-20">
        <button
          onClick={() => setSelectedBeaconId('home')}
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
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm transition-all duration-200 relative group ${
                        isSelected 
                          ? 'bg-[#00F0FF] text-[#07090E] rounded-xl shadow-[0_0_15px_rgba(0,240,255,0.4)]' 
                          : 'bg-[#151922] text-[#94A3B8] hover:text-[#F0F4F8] hover:rounded-xl hover:bg-[#1C222E]'
                      }`}
                    >
                      {beacon.name.substring(0, 2).toUpperCase()}
                      {beacon.unreadCount && (
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
        <div className="h-14 px-4 border-b border-[#232936] flex items-center justify-between font-semibold tracking-wide text-[#F0F4F8]">
          <span className="truncate">Aegis Command</span>
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
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#151922] border border-[#232936] flex items-center justify-center text-sm font-bold text-[#00F0FF]">
              AO
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
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setIsDeafened(p => !p)}
              className={`p-1.5 rounded-lg hover:bg-[#151922] transition-colors ${isDeafened ? 'text-[#FF3366]' : 'hover:text-[#F0F4F8]'}`}
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

          <div className="flex items-center gap-3">
            {/* Quick Scan Trigger */}
            <button
              onClick={() => setIsQuickScanOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#151922] border border-[#232936] text-xs text-[#94A3B8] hover:text-[#F0F4F8] hover:border-[#00F0FF]/40 transition-all"
            >
              <Search className="w-3.5 h-3.5 text-[#00F0FF]" />
              <span>Subspace Quick Scan</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#0B0E14] text-[10px] font-mono border border-[#232936]">
                Ctrl+K
              </kbd>
            </button>

            {/* Platform indicator badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151922] border border-[#232936] text-[11px] font-mono">
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

          {messages.map((m) => (
            <div key={m.id} className="flex items-start gap-4 group hover:bg-[#151922]/40 -mx-4 px-4 py-2 rounded-2xl transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#151922] border border-[#232936] flex items-center justify-center text-lg shrink-0">
                {m.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-[#F0F4F8]">{m.author}</span>
                  {m.staffRank && m.staffRank > 0 && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#00F0FF]/20 text-[#00F0FF] font-bold">
                      {m.staffRank === 3 ? 'Root Staff' : m.staffRank === 2 ? 'Admin' : 'Moderator'}
                    </span>
                  )}
                  <span className="text-xs text-[#64748B]">{m.timestamp}</span>
                </div>
                <div className="mt-1 text-sm text-[#E2E8F0] leading-relaxed break-words">
                  {m.content}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input Bar */}
        <form onSubmit={handleSendMessage} className="p-4 bg-[#07090E] border-t border-[#232936]">
          <div className="flex items-center gap-2 bg-[#151922] border border-[#232936] rounded-2xl px-4 py-2.5 focus-within:border-[#00F0FF] focus-within:shadow-[0_0_20px_rgba(0,240,255,0.15)] transition-all">
            <button
              type="button"
              className="p-1.5 text-[#94A3B8] hover:text-[#00F0FF] transition-colors"
              title="Attach Transmission Artifact (Vault S3 Presigned Gate)"
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
