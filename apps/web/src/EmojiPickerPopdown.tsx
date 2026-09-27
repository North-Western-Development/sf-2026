import React, { useState, useRef, useMemo } from 'react';
import { 
  Search, 
  Clock, 
  Smile, 
  Rocket, 
  ThumbsUp, 
  Sparkles, 
  X, 
  Radio
} from 'lucide-react';

export interface CustomEmoji {
  id: string;
  name: string;
  url: string;
}

interface EmojiPickerPopdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  customEmojis?: CustomEmoji[];
  serverName?: string;
  serverIcon?: string;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: Array<{ char: string; name: string; isCustom?: boolean; url?: string }>;
}

const FREQUENTLY_USED = [
  { char: '⚡', name: 'quantum_spark' },
  { char: '🚀', name: 'rocket' },
  { char: '🛸', name: 'ufo' },
  { char: '🛰️', name: 'satellite' },
  { char: '✨', name: 'sparkles' },
  { char: '👍', name: 'thumbs_up' },
  { char: '🔥', name: 'fire' },
  { char: '💎', name: 'crystal' },
];

const STANDARD_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: <Smile className="w-4 h-4" />,
    emojis: [
      { char: '😀', name: 'grinning' },
      { char: '😃', name: 'smiley' },
      { char: '😄', name: 'smile' },
      { char: '😁', name: 'beam' },
      { char: '😆', name: 'laughing' },
      { char: '😅', name: 'sweat_smile' },
      { char: '😂', name: 'joy' },
      { char: '🤣', name: 'rofl' },
      { char: '😊', name: 'blush' },
      { char: '😇', name: 'innocent' },
      { char: '🙂', name: 'slight_smile' },
      { char: '🙃', name: 'upside_down' },
      { char: '😉', name: 'wink' },
      { char: '😌', name: 'relieved' },
      { char: '😍', name: 'heart_eyes' },
      { char: '🥰', name: 'smiling_face_with_3_hearts' },
      { char: '😘', name: 'kissing_heart' },
      { char: '😎', name: 'sunglasses' },
      { char: '🤓', name: 'nerd' },
      { char: '🧐', name: 'monocle' },
      { char: '🥳', name: 'partying_face' },
      { char: '😏', name: 'smirk' },
      { char: '🥺', name: 'pleading_face' },
      { char: '😭', name: 'sob' },
    ],
  },
  {
    id: 'cosmos',
    name: 'Subspace & Cosmos',
    icon: <Rocket className="w-4 h-4" />,
    emojis: [
      { char: '🚀', name: 'rocket' },
      { char: '🛸', name: 'ufo' },
      { char: '🛰️', name: 'satellite' },
      { char: '🪐', name: 'saturn' },
      { char: '🌌', name: 'milky_way' },
      { char: '⚡', name: 'zap' },
      { char: '✨', name: 'sparkles' },
      { char: '☄️', name: 'comet' },
      { char: '🌟', name: 'glowing_star' },
      { char: '🌠', name: 'shooting_star' },
      { char: '🌑', name: 'new_moon' },
      { char: '🌕', name: 'full_moon' },
      { char: '🔭', name: 'telescope' },
      { char: '🌍', name: 'earth' },
      { char: '👾', name: 'space_invader' },
      { char: '🤖', name: 'robot' },
    ],
  },
  {
    id: 'gestures',
    name: 'Gestures & Reactions',
    icon: <ThumbsUp className="w-4 h-4" />,
    emojis: [
      { char: '👍', name: 'thumbs_up' },
      { char: '👎', name: 'thumbs_down' },
      { char: '👏', name: 'clap' },
      { char: '🙌', name: 'raised_hands' },
      { char: '🤝', name: 'handshake' },
      { char: '✌️', name: 'victory' },
      { char: '🤞', name: 'crossed_fingers' },
      { char: '🖖', name: 'vulcan_salute' },
      { char: '🤘', name: 'rock_on' },
      { char: '🤙', name: 'call_me' },
      { char: '💪', name: 'flex' },
      { char: '🫡', name: 'salute' },
      { char: '🙏', name: 'pray' },
      { char: '👋', name: 'wave' },
      { char: '❤️', name: 'heart' },
      { char: '💙', name: 'blue_heart' },
    ],
  },
  {
    id: 'artifacts',
    name: 'Signals & Artifacts',
    icon: <Sparkles className="w-4 h-4" />,
    emojis: [
      { char: '🎉', name: 'tada' },
      { char: '🏆', name: 'trophy' },
      { char: '💎', name: 'gem' },
      { char: '🔥', name: 'fire' },
      { char: '🛡️', name: 'shield' },
      { char: '🔑', name: 'key' },
      { char: '🔒', name: 'locked' },
      { char: '📡', name: 'satellite_antenna' },
      { char: '🧭', name: 'compass' },
      { char: '⚙️', name: 'gear' },
      { char: '☣️', name: 'biohazard' },
      { char: '☢️', name: 'radioactive' },
      { char: '⚠️', name: 'warning' },
      { char: '🛑', name: 'stop_sign' },
      { char: '💡', name: 'bulb' },
      { char: '📦', name: 'package' },
    ],
  },
];

const SKIN_TONES = [
  { label: 'Default', mod: '' },
  { label: 'Light', mod: '🏻' },
  { label: 'Medium-Light', mod: '🏼' },
  { label: 'Medium', mod: '🏽' },
  { label: 'Medium-Dark', mod: '🏾' },
  { label: 'Dark', mod: '🏿' },
];

export const EmojiPickerPopdown: React.FC<EmojiPickerPopdownProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
  customEmojis = [],
  serverName = 'Current Beacon',
  serverIcon,
}) => {
  const [activeTab, setActiveTab] = useState<'gifs' | 'stickers' | 'emoji'>('emoji');
  const [search, setSearch] = useState('');
  const [showBanner, setShowBanner] = useState(true);
  const [selectedSkinTone, setSelectedSkinTone] = useState('');
  const [showSkinPicker, setShowSkinPicker] = useState(false);
  const [hoveredEmoji, setHoveredEmoji] = useState<{
    char?: string;
    name: string;
    origin: string;
    url?: string;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollToCategory = (id: string) => {
    const el = categoryRefs.current[id];
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const filteredCustomEmojis = useMemo(() => {
    if (!search.trim()) return customEmojis;
    return customEmojis.filter(e => e.name.toLowerCase().includes(search.toLowerCase().replace(/:/g, '')));
  }, [customEmojis, search]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return STANDARD_CATEGORIES;
    const q = search.toLowerCase().replace(/:/g, '');
    return STANDARD_CATEGORIES.map(cat => ({
      ...cat,
      emojis: cat.emojis.filter(e => e.name.toLowerCase().includes(q) || e.char.includes(q)),
    })).filter(cat => cat.emojis.length > 0);
  }, [search]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute bottom-14 right-4 w-[430px] h-[480px] bg-[#111214] border border-[#1f2024] rounded-[12px] shadow-2xl z-50 flex flex-col overflow-hidden select-none animate-in fade-in zoom-in-95 font-sans"
      onClick={(e) => e.stopPropagation()}
      data-testid="discord-emoji-picker"
    >
      {/* 1. Header with Tabs & Search */}
      <div className="p-3 border-b border-[#1f2024] bg-[#111214] shrink-0">
        {/* Top Switcher Tabs */}
        <div className="flex items-center gap-1.5 mb-3 bg-[#1e1f22] p-1 rounded-[8px] w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('gifs')}
            className={`px-3 py-1 rounded-[6px] text-xs font-bold transition-all ${
              activeTab === 'gifs'
                ? 'bg-[#2b2d31] text-white shadow-sm'
                : 'text-[#949ba4] hover:text-[#dbdee1]'
            }`}
          >
            GIFs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stickers')}
            className={`px-3 py-1 rounded-[6px] text-xs font-bold transition-all ${
              activeTab === 'stickers'
                ? 'bg-[#2b2d31] text-white shadow-sm'
                : 'text-[#949ba4] hover:text-[#dbdee1]'
            }`}
          >
            Stickers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('emoji')}
            className={`px-3 py-1 rounded-[6px] text-xs font-bold transition-all ${
              activeTab === 'emoji'
                ? 'bg-[#2b2d31] text-white shadow-sm'
                : 'text-[#949ba4] hover:text-[#dbdee1]'
            }`}
          >
            Emoji
          </button>
        </div>

        {/* Search Bar + Skin Tone Selector */}
        <div className="flex items-center gap-2 relative">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-[#949ba4] absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder=":shortcode:"
              className="w-full bg-[#1e1f22] border border-[#2b2d31] focus:border-[#5865f2] focus:ring-1 focus:ring-[#5865f2] rounded-[8px] pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#80848e] outline-none transition-all"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowSkinPicker(!showSkinPicker)}
            className="w-8 h-8 rounded-[8px] bg-[#1e1f22] hover:bg-[#2b2d31] text-base flex items-center justify-center transition-colors border border-[#2b2d31] relative"
            title="Choose Skin Tone"
          >
            {`👋${selectedSkinTone}`}
          </button>

          {/* Skin Tone Selector Popup */}
          {showSkinPicker && (
            <div className="absolute right-0 top-10 bg-[#1e1f22] border border-[#2b2d31] rounded-[8px] p-1.5 shadow-xl flex gap-1 z-30">
              {SKIN_TONES.map(st => (
                <button
                  key={st.label}
                  type="button"
                  onClick={() => {
                    setSelectedSkinTone(st.mod);
                    setShowSkinPicker(false);
                  }}
                  className="w-6 h-6 rounded hover:bg-[#2b2d31] flex items-center justify-center text-sm"
                  title={st.label}
                >
                  {`👋${st.mod}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Main Content Body: Left Category Rail + Right Scrollable Grid */}
      <div className="flex flex-1 min-h-0">
        {/* Left Category Rail */}
        <div className="w-12 bg-[#0b0c0e] border-r border-[#1f2024] flex flex-col items-center py-2.5 gap-2 overflow-y-auto shrink-0 scrollbar-none">
          {/* Frequently Used */}
          <button
            type="button"
            onClick={() => scrollToCategory('frequent')}
            className="w-8 h-8 rounded-[8px] hover:bg-[#1e1f22] text-[#949ba4] hover:text-white flex items-center justify-center transition-all"
            title="Frequently Used"
          >
            <Clock className="w-4 h-4" />
          </button>

          {/* Server Glyphs Category */}
          {customEmojis.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToCategory('server')}
              className="w-8 h-8 rounded-[8px] hover:bg-[#1e1f22] text-[#00f0ff] flex items-center justify-center transition-all"
              title={serverName}
            >
              {serverIcon ? (
                <img src={serverIcon} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <Radio className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Standard Categories */}
          {STANDARD_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => scrollToCategory(cat.id)}
              className="w-8 h-8 rounded-[8px] hover:bg-[#1e1f22] text-[#949ba4] hover:text-white flex items-center justify-center transition-all"
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>

        {/* Right Scrollable Emoji Area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-thin scrollbar-thumb-[#1e1f22]"
        >
          {/* Nitro/Perks Alert Banner */}
          {showBanner && !search.trim() && (
            <div className="bg-[#1e1f22]/90 border border-[#2b2d31] rounded-[8px] p-2.5 flex items-start gap-2.5 relative">
              <Sparkles className="w-4 h-4 text-[#eb459e] shrink-0 mt-0.5" />
              <div className="text-[11px] text-[#dbdee1] pr-5 leading-snug">
                <span className="font-semibold text-white">Subspace Quantum Glyphs active.</span> Enjoy global custom emojis across all synchronized beacons.
              </div>
              <button
                type="button"
                onClick={() => setShowBanner(false)}
                className="absolute top-2 right-2 text-[#949ba4] hover:text-white"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Frequently Used Section */}
          {!search.trim() && (
            <div ref={el => { categoryRefs.current['frequent'] = el; }}>
              <div className="text-[11px] uppercase font-bold text-[#949ba4] mb-2 flex items-center gap-1.5 tracking-wider">
                <Clock className="w-3 h-3 text-[#dbdee1]" />
                <span>Frequently Used</span>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {FREQUENTLY_USED.map((emoji, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      onSelectEmoji(emoji.char);
                      onClose();
                    }}
                    onMouseEnter={() => setHoveredEmoji({ char: emoji.char, name: emoji.name, origin: 'Frequently Used' })}
                    className="w-9 h-9 rounded-[6px] hover:bg-[#1e1f22] text-xl flex items-center justify-center transition-transform hover:scale-125"
                  >
                    {emoji.char}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Server Custom Emojis */}
          {filteredCustomEmojis.length > 0 && (
            <div ref={el => { categoryRefs.current['server'] = el; }}>
              <div className="text-[11px] uppercase font-bold text-[#949ba4] mb-2 flex items-center gap-1.5 tracking-wider">
                <Radio className="w-3 h-3 text-[#00f0ff]" />
                <span>{serverName}</span>
                <span className="text-[10px] text-[#80848e] lowercase">({filteredCustomEmojis.length})</span>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {filteredCustomEmojis.map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    onClick={() => {
                      onSelectEmoji(`:${emoji.name}:`);
                      onClose();
                    }}
                    onMouseEnter={() => setHoveredEmoji({ name: emoji.name, origin: serverName, url: emoji.url })}
                    className="w-9 h-9 rounded-[6px] hover:bg-[#1e1f22] flex items-center justify-center transition-transform hover:scale-125"
                    title={`:${emoji.name}:`}
                  >
                    <img src={emoji.url} alt={emoji.name} className="w-6 h-6 object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Standard Categories */}
          {filteredCategories.map((cat) => (
            <div key={cat.id} ref={el => { categoryRefs.current[cat.id] = el; }}>
              <div className="text-[11px] uppercase font-bold text-[#949ba4] mb-2 flex items-center gap-1.5 tracking-wider">
                <span>{cat.name}</span>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {cat.emojis.map((emoji, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      onSelectEmoji(emoji.char);
                      onClose();
                    }}
                    onMouseEnter={() => setHoveredEmoji({ char: emoji.char, name: emoji.name, origin: cat.name })}
                    className="w-9 h-9 rounded-[6px] hover:bg-[#1e1f22] text-xl flex items-center justify-center transition-transform hover:scale-125"
                  >
                    {emoji.char}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Bottom Inspection Preview Footer */}
      <div className="h-14 bg-[#0b0c0e] border-t border-[#1f2024] px-3.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {hoveredEmoji ? (
            <>
              <div className="w-9 h-9 rounded-[6px] bg-[#1e1f22] flex items-center justify-center text-2xl shrink-0 border border-[#2b2d31]">
                {hoveredEmoji.url ? (
                  <img src={hoveredEmoji.url} alt={hoveredEmoji.name} className="w-6 h-6 object-contain" />
                ) : (
                  <span>{hoveredEmoji.char}</span>
                )}
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="text-xs font-bold text-white truncate font-mono">
                  :{hoveredEmoji.name}:
                </span>
                <span className="text-[10px] text-[#949ba4] truncate">
                  from {hoveredEmoji.origin}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="w-9 h-9 rounded-[6px] bg-[#1e1f22] flex items-center justify-center text-[#949ba4] shrink-0 border border-[#2b2d31]">
                <Smile className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="text-xs font-semibold text-[#dbdee1]">Select an emoji</span>
                <span className="text-[10px] text-[#949ba4]">Hover over an emoji to inspect</span>
              </div>
            </>
          )}
        </div>

        {hoveredEmoji?.url && (
          <div className="text-[9px] uppercase tracking-wider font-bold bg-[#00f0ff]/10 text-[#00f0ff] px-2 py-0.5 rounded border border-[#00f0ff]/30">
            Custom
          </div>
        )}
      </div>
    </div>
  );
};
