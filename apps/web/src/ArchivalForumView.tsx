import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Pin, 
  Lock, 
  Plus, 
  Search, 
  Send, 
  X,
  Settings,
  Bell,
  Smile,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Quote,
  Code,
  Eye,
  SlidersHorizontal,
  Check,
  Trash2,
  Unlock,
  MoreHorizontal,
  Copy
} from 'lucide-react';
import { useContextMenu, ContextMenuItem } from '@subspace/ui';
import { MarkdownMessage } from './MarkdownMessage';
import { api } from './services/api';

export interface ArchivalThread {
  id: string;
  title: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  transmissionCount: number;
  lastTransmissionAt: string;
  createdAt: string;
  snippet?: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
}

interface ArchivalForumViewProps {
  relayId: string;
  relayName: string;
  currentUser?: any;
  onOpenUserProfile?: (user: any) => void;
  onUpdateRelayTopic?: (topic: string) => void;
  onDeleteRelay?: (relayId: string) => void;
}

export const ArchivalForumView: React.FC<ArchivalForumViewProps> = ({
  relayId,
  relayName,
  currentUser,
  onOpenUserProfile,
  onUpdateRelayTopic,
  onDeleteRelay,
}) => {
  const [threads, setThreads] = useState<ArchivalThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ArchivalThread | null>(null);
  const [threadTransmissions, setThreadTransmissions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [replyInput, setReplyInput] = useState('');
  const [, setLoading] = useState(false);

  // Forum Channel Settings Modal State (Screenshot 5 inspired)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsChannelName, setSettingsChannelName] = useState(relayName);
  const [postGuidelines, setPostGuidelines] = useState(
    'Please keep discussions constructive and mission-focused. Search for existing threads before creating a new one.'
  );
  const [forumTags, setForumTags] = useState<string[]>(['support', 'discussion', 'bug-report', 'orbital']);
  const [newTagInput, setNewTagInput] = useState('');
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [requireTags, setRequireTags] = useState(false);
  const [defaultReaction, setDefaultReaction] = useState('👍');
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [postsSlowmode, setPostsSlowmode] = useState('off');
  const [messagesSlowmode, setMessagesSlowmode] = useState('off');
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Post reactions state for OP and replies
  const [threadReactions, setThreadReactions] = useState<Record<string, { emoji: string; count: number; active?: boolean }[]>>({});

  // Context Menu & Toast notifications
  const { openContextMenu } = useContextMenu();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const hasManagePerms = Boolean(
    currentUser?.isOwner ||
    (currentUser?.staffRank && currentUser.staffRank >= 1) ||
    currentUser?.roles?.some((r: string) => ['command staff', 'admin', 'moderator', 'sysop'].some(role => r.toLowerCase().includes(role)))
  );

  const canManageThread = (thread: ArchivalThread) => {
    return Boolean(
      hasManagePerms ||
      (currentUser?.id && (thread.author?.id === currentUser.id || (thread as any).transmitterId === currentUser.id)) ||
      (currentUser?.callsign && (thread.author?.username === currentUser.callsign || thread.author?.displayName === currentUser.callsign)) ||
      (currentUser?.name && (thread.author?.displayName === currentUser.name || thread.author?.username === currentUser.name))
    );
  };

  const getThreadOverrides = (): Record<string, { isLocked?: boolean; isPinned?: boolean }> => {
    try {
      const raw = localStorage.getItem(`subspace_thread_overrides_${relayId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const setThreadOverride = (threadId: string, updates: { isLocked?: boolean; isPinned?: boolean }) => {
    try {
      const overrides = getThreadOverrides();
      overrides[threadId] = { ...overrides[threadId], ...updates };
      localStorage.setItem(`subspace_thread_overrides_${relayId}`, JSON.stringify(overrides));
    } catch (_) {}
  };

  const getCachedReplies = (threadId: string) => {
    try {
      const raw = localStorage.getItem(`subspace_thread_replies_${threadId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const handleToggleThreadLock = async (thread: ArchivalThread) => {
    const nextLocked = !thread.isLocked;
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isLocked: nextLocked } : t));
    if (selectedThread?.id === thread.id) {
      setSelectedThread(prev => prev ? { ...prev, isLocked: nextLocked } : null);
    }
    setThreadOverride(thread.id, { isLocked: nextLocked });
    showToast(nextLocked ? `Locked thread "${thread.title}"` : `Unlocked thread "${thread.title}"`);

    try {
      await api.updateArchivalThread(relayId, thread.id, { isLocked: nextLocked });
    } catch (err: any) {
      console.warn('Failed to sync thread lock state to backend:', err.message);
      if (err.message && !err.message.includes('Failed to fetch')) {
        // Revert on explicit rejection
        setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isLocked: thread.isLocked } : t));
        if (selectedThread?.id === thread.id) {
          setSelectedThread(prev => prev ? { ...prev, isLocked: thread.isLocked } : null);
        }
        setThreadOverride(thread.id, { isLocked: thread.isLocked });
        showToast(`Failed to update thread lock: ${err.message}`);
      }
    }
  };

  const handleToggleThreadPin = async (thread: ArchivalThread) => {
    const nextPinned = !thread.isPinned;
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isPinned: nextPinned } : t));
    if (selectedThread?.id === thread.id) {
      setSelectedThread(prev => prev ? { ...prev, isPinned: nextPinned } : null);
    }
    setThreadOverride(thread.id, { isPinned: nextPinned });
    showToast(nextPinned ? `Pinned thread "${thread.title}"` : `Unpinned thread "${thread.title}"`);

    try {
      await api.updateArchivalThread(relayId, thread.id, { isPinned: nextPinned });
    } catch (err: any) {
      console.warn('Failed to sync thread pin state to backend:', err.message);
      if (err.message && !err.message.includes('Failed to fetch')) {
        setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isPinned: thread.isPinned } : t));
        if (selectedThread?.id === thread.id) {
          setSelectedThread(prev => prev ? { ...prev, isPinned: thread.isPinned } : null);
        }
        setThreadOverride(thread.id, { isPinned: thread.isPinned });
        showToast(`Failed to update thread pin: ${err.message}`);
      }
    }
  };

  const getThreadContextMenu = (thread: ArchivalThread): ContextMenuItem[] => [
    ...(canManageThread(thread) ? [
      {
        label: thread.isLocked ? 'Unlock Thread' : 'Lock Thread',
        icon: thread.isLocked ? <Unlock className="w-3.5 h-3.5 text-[#23a55a]" /> : <Lock className="w-3.5 h-3.5 text-[#e5a50a]" />,
        onClick: () => handleToggleThreadLock(thread),
      },
      {
        label: thread.isPinned ? 'Unpin Thread' : 'Pin Thread',
        icon: <Pin className={`w-3.5 h-3.5 ${thread.isPinned ? 'text-[#00f0ff]' : 'text-[#949ba4]'}`} />,
        onClick: () => handleToggleThreadPin(thread),
      },
      { separator: true },
    ] : []),
    {
      label: 'Copy Thread Link',
      icon: <Copy className="w-3.5 h-3.5 text-[#dbdee1]" />,
      onClick: () => {
        navigator.clipboard?.writeText(window.location.href);
        showToast('Copied thread link to clipboard');
      },
    },
    {
      label: 'Copy Thread ID',
      icon: <Copy className="w-3.5 h-3.5 text-[#80848e]" />,
      onClick: () => {
        navigator.clipboard?.writeText(thread.id);
        showToast(`Copied ${thread.id}`);
      },
    },
  ];

  const loadThreads = async () => {
    setLoading(true);
    try {
      const data = await api.getArchivalThreads(relayId, selectedTag || undefined);
      const overrides = getThreadOverrides();
      if (data && Array.isArray(data.threads)) {
        const mapped = (data.threads || []).map((t: any) => {
          const threadObj = t.thread || t;
          const override = overrides[threadObj.id] || {};
          return {
            ...threadObj,
            author: t.author || threadObj.author,
            isLocked: override.isLocked !== undefined ? override.isLocked : Boolean(threadObj.isLocked),
            isPinned: override.isPinned !== undefined ? override.isPinned : Boolean(threadObj.isPinned),
            snippet: threadObj.snippet || (t.rootTransmission?.content ? t.rootTransmission.content.slice(0, 140) : undefined),
          };
        });
        setThreads(mapped);

        if (selectedThread) {
          const fresh = mapped.find(m => m.id === selectedThread.id);
          if (fresh) {
            setSelectedThread(fresh);
          }
        }
      }
    } catch (err: any) {
      console.warn('Failed to load archival threads from API:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, [relayId, selectedTag]);

  const loadThreadReplies = async (threadId: string) => {
    const localReplies = getCachedReplies(threadId);

    try {
      const [threadData, transData] = await Promise.all([
        api.getArchivalThread(relayId, threadId).catch(() => null),
        api.getArchivalThreadTransmissions(relayId, threadId).catch(() => null),
      ]);

      let rootItem: any = null;
      if (threadData?.rootTransmission) {
        rootItem = {
          id: threadData.rootTransmission.id,
          content: threadData.rootTransmission.content,
          createdAt: threadData.rootTransmission.createdAt,
          authorName: threadData.author?.displayName || threadData.author?.username || 'Author',
          authorUsername: threadData.author?.username || 'author',
          authorAvatar: threadData.author?.avatarUrl || '📜',
          isRoot: true,
        };
      }

      let fetchedTransmissions: any[] = [];
      if (transData && Array.isArray(transData.transmissions)) {
        const rootId = threadData?.thread?.rootTransmissionId || rootItem?.id;
        fetchedTransmissions = transData.transmissions.map((t: any, idx: number) => {
          const isRoot = t.transmission.id === rootId || (!rootId && idx === 0);
          return {
            id: t.transmission.id,
            content: t.transmission.content,
            createdAt: t.transmission.createdAt,
            authorName: t.author?.displayName || t.author?.username || 'Transmitter',
            authorUsername: t.author?.username || 'transmitter',
            authorAvatar: t.author?.avatarUrl || '⚡',
            isRoot,
          };
        });
      }

      if (!rootItem && fetchedTransmissions.length > 0 && fetchedTransmissions[0].isRoot) {
        rootItem = fetchedTransmissions[0];
      }

      const repliesList = fetchedTransmissions.filter(tx => !tx.isRoot);
      const existingIds = new Set([
        ...(rootItem ? [rootItem.id] : []),
        ...repliesList.map(r => r.id),
      ]);

      const unsyncedLocals = localReplies.filter((lr: any) => !existingIds.has(lr.id));
      const combined = [
        ...(rootItem ? [rootItem] : []),
        ...repliesList,
        ...unsyncedLocals,
      ];

      setThreadTransmissions(combined);

      if (threadData?.thread) {
        const overrides = getThreadOverrides();
        const override = overrides[threadId] || {};
        const isLockedVal = override.isLocked !== undefined ? override.isLocked : Boolean(threadData.thread.isLocked);
        const isPinnedVal = override.isPinned !== undefined ? override.isPinned : Boolean(threadData.thread.isPinned);

        setSelectedThread(prev => {
          if (!prev || prev.id !== threadId) return prev;
          return {
            ...prev,
            ...threadData.thread,
            author: threadData.author || prev.author,
            isLocked: isLockedVal,
            isPinned: isPinnedVal,
            transmissionCount: Math.max(threadData.thread.transmissionCount, combined.length),
          };
        });

        setThreads(prev => prev.map(t => t.id === threadId ? {
          ...t,
          ...threadData.thread,
          author: threadData.author || t.author,
          isLocked: isLockedVal,
          isPinned: isPinnedVal,
          transmissionCount: Math.max(threadData.thread.transmissionCount, combined.length),
        } : t));
      }
    } catch (err: any) {
      console.warn('Failed to load thread replies from API:', err.message);
      if (localReplies.length > 0) {
        setThreadTransmissions(prev => {
          const root = prev.filter(p => p.isRoot);
          return [...root, ...localReplies];
        });
      }
    }
  };

  const handleSelectThread = (thread: ArchivalThread) => {
    const overrides = getThreadOverrides();
    const override = overrides[thread.id] || {};
    const activeThread: ArchivalThread = {
      ...thread,
      isLocked: override.isLocked !== undefined ? override.isLocked : thread.isLocked,
      isPinned: override.isPinned !== undefined ? override.isPinned : thread.isPinned,
    };

    setSelectedThread(activeThread);
    const rootItem = activeThread.snippet ? [{
      id: `root-${activeThread.id}`,
      content: activeThread.snippet,
      createdAt: activeThread.createdAt,
      authorName: activeThread.author?.displayName || activeThread.author?.username || 'Author',
      authorUsername: activeThread.author?.username || 'author',
      authorAvatar: activeThread.author?.avatarUrl || '📜',
      isRoot: true,
    }] : [];
    setThreadTransmissions(rootItem);
    loadThreadReplies(activeThread.id);
  };

  const handleCreateThreadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const title = newTitle.trim();
    const content = newContent.trim();
    const tagsArray = newTags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    setNewTitle('');
    setNewContent('');
    setNewTags('');
    setIsCreatingThread(false);

    const now = new Date();
    const optimisticThread: ArchivalThread = {
      id: `thread-${Date.now()}`,
      title,
      tags: tagsArray,
      isPinned: false,
      isLocked: false,
      transmissionCount: 1,
      lastTransmissionAt: now.toISOString(),
      createdAt: now.toISOString(),
      snippet: content.slice(0, 140),
      author: {
        id: currentUser?.id || 'u-self',
        username: currentUser?.callsign || currentUser?.username || 'cmdr_you',
        displayName: currentUser?.name || currentUser?.displayName || 'Command Officer (You)',
        avatarUrl: currentUser?.avatar || currentUser?.avatarUrl || '⚡',
      },
    };

    setThreads(prev => [optimisticThread, ...prev]);

    try {
      const data = await api.createArchivalThread(relayId, title, content, tagsArray);
      if (data?.thread) {
        await loadThreads();
      }
    } catch (err: any) {
      console.warn('Created thread locally (backend sync notice):', err.message);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThread || !replyInput.trim()) return;

    if (selectedThread.isLocked) {
      showToast('This thread is locked for new transmissions.');
      return;
    }

    const content = replyInput.trim();
    setReplyInput('');

    // Optimistic reply creation
    const now = new Date();
    const newReply = {
      id: `reply-${Date.now()}`,
      content,
      createdAt: now.toISOString(),
      authorName: currentUser?.name || currentUser?.displayName || 'Command Officer (You)',
      authorUsername: currentUser?.callsign || currentUser?.username || 'cmdr_you',
      authorAvatar: currentUser?.avatar || currentUser?.avatarUrl || '⚡',
      isRoot: false,
    };

    // Save to local cache
    try {
      const repliesKey = `subspace_thread_replies_${selectedThread.id}`;
      const existing = JSON.parse(localStorage.getItem(repliesKey) || '[]');
      existing.push(newReply);
      localStorage.setItem(repliesKey, JSON.stringify(existing));
    } catch (_) {}

    setThreadTransmissions(prev => [...prev, newReply]);
    setThreads(prev => prev.map(t => t.id === selectedThread.id ? { ...t, transmissionCount: t.transmissionCount + 1 } : t));
    setSelectedThread(prev => prev ? { ...prev, transmissionCount: prev.transmissionCount + 1 } : null);

    try {
      const data = await api.sendArchivalThreadReply(relayId, selectedThread.id, content);
      if (data?.transmission) {
        await loadThreadReplies(selectedThread.id);
      }
    } catch (err: any) {
      console.warn('Backend reply notice (retained in thread):', err.message);
      if (err.message && !err.message.includes('Failed to fetch')) {
        showToast(`Notice: ${err.message}`);
      }
    }
  };

  const handleToggleReaction = (msgId: string, emoji: string) => {
    setThreadReactions(prev => {
      const current = prev[msgId] || [];
      const existing = current.find(r => r.emoji === emoji);
      if (existing) {
        if (existing.active) {
          return {
            ...prev,
            [msgId]: current.map(r => r.emoji === emoji ? { ...r, count: Math.max(0, r.count - 1), active: false } : r).filter(r => r.count > 0),
          };
        } else {
          return {
            ...prev,
            [msgId]: current.map(r => r.emoji === emoji ? { ...r, count: r.count + 1, active: true } : r),
          };
        }
      }
      return {
        ...prev,
        [msgId]: [...current, { emoji, count: 1, active: true }],
      };
    });
  };

  const handleAddTag = () => {
    if (!newTagInput.trim()) return;
    const clean = newTagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!forumTags.includes(clean)) {
      setForumTags([...forumTags, clean]);
    }
    setNewTagInput('');
    setIsCreatingTag(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setForumTags(forumTags.filter(t => t !== tagToRemove));
  };

  const allTags = Array.from(new Set([...forumTags, ...threads.flatMap(t => t.tags || [])]));
  const filteredThreads = threads.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.snippet && t.snippet.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatRelativeTime = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 30) return '>30d ago';
    return `${diffDays}d ago`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#000000] text-[#dbdee1] min-w-0 select-none">
      {/* ─── Main Content Area (Split-Pane or Full-Width Board) ─────────── */}
      <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
        {/* Left Pane: Thread Board (Screenshots 3 & 4) */}
        <div className={`flex flex-col min-h-0 bg-[#000000] transition-all duration-150 ${
          selectedThread 
            ? 'w-[45%] min-w-[340px] max-w-[560px] border-r border-[#1a1b1e]' 
            : 'w-full max-w-5xl mx-auto'
        }`}>
          {/* Top Search & Actions Bar (Matching Screenshots 3 & 4) */}
          <div className="p-4 border-b border-[#1a1b1e]/60 bg-[#090a0c] space-y-3 shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#80848e]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search or create a post..."
                  className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff] rounded-[6px] pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none transition-colors"
                />
              </div>

              <button
                className="px-2.5 py-1.5 bg-[#16171a] hover:bg-[#202226] border border-[#1f2024] rounded-[6px] text-xs font-semibold text-[#dbdee1] hover:text-white flex items-center gap-1.5 transition-colors shrink-0"
                title="Sort & Filter"
              >
                <SlidersHorizontal className="w-3 h-3 text-[#00f0ff]" />
                <span className="hidden sm:inline">Sort &amp; View</span>
              </button>

              <button
                onClick={() => setIsCreatingThread(true)}
                className="bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold px-3 py-1.5 rounded-[6px] flex items-center gap-1.5 transition-colors shrink-0 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Thread</span>
              </button>

              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-1.5 rounded-[6px] hover:bg-[#16171a] border border-[#1f2024] text-[#949ba4] hover:text-white transition-colors shrink-0"
                title="Forum Channel Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tags Pills Row */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2.5 py-0.5 rounded-[12px] font-medium transition-colors shrink-0 ${
                    selectedTag === null
                      ? 'bg-white text-black font-semibold'
                      : 'bg-[#16171a] text-[#949ba4] hover:text-white border border-[#1f2024]'
                  }`}
                >
                  All
                </button>
                {allTags.map(tg => (
                  <button
                    key={tg}
                    onClick={() => setSelectedTag(selectedTag === tg ? null : tg)}
                    className={`px-2.5 py-0.5 rounded-[12px] font-medium transition-colors shrink-0 flex items-center gap-1 ${
                      selectedTag === tg
                        ? 'bg-[#00f0ff] text-black font-semibold'
                        : 'bg-[#16171a] text-[#949ba4] hover:text-white border border-[#1f2024]'
                    }`}
                  >
                    <span>#{tg}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Create Thread Inline Composer */}
          {isCreatingThread && (
            <form onSubmit={handleCreateThreadSubmit} className="m-4 bg-[#0b0c0e] border border-[#00f0ff]/40 p-4 rounded-[10px] space-y-3 shadow-xl shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-[#00f0ff]" />
                  <span>Create New Thread</span>
                </h3>
                <button type="button" onClick={() => setIsCreatingThread(false)} className="text-xs text-[#949ba4] hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Title (e.g. Apparent pixel misalignment with display)"
                className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
                autoFocus
              />

              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="What would you like to discuss? Markdown, quotes, and code blocks supported..."
                className="w-full h-24 bg-[#111214] border border-[#1f2024] rounded-[6px] p-2.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none"
              />

              <input
                type="text"
                value={newTags}
                onChange={e => setNewTags(e.target.value)}
                placeholder="Tags (comma separated, e.g. support, ui, bug)"
                className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
              />

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreatingThread(false)}
                  className="px-3 py-1.5 rounded-[4px] text-xs text-[#949ba4] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || !newContent.trim()}
                  className="bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-40 text-white text-xs font-semibold px-4 py-1.5 rounded-[4px] transition-colors"
                >
                  Post Thread
                </button>
              </div>
            </form>
          )}

          {/* Threads List (Matching Screenshot 3 & 4 Cards) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text">
            {filteredThreads.length === 0 ? (
              <div className="text-center py-16 text-[#949ba4] bg-[#080809] border border-[#1f2024] rounded-[8px] m-2">
                <MessageSquare className="w-8 h-8 text-[#3f4147] mx-auto mb-2" />
                <p className="font-semibold text-white text-sm">No threads found</p>
                <p className="text-xs mt-1 text-[#80848e]">Be the first to post a new thread in #{relayName}.</p>
              </div>
            ) : (
              filteredThreads.map(thread => {
                const isSelected = selectedThread?.id === thread.id;
                return (
                  <div
                    key={thread.id}
                    onClick={() => handleSelectThread(thread)}
                    onContextMenu={(e) => openContextMenu(e, getThreadContextMenu(thread))}
                    className={`p-3 rounded-[8px] border transition-all cursor-pointer group flex flex-col justify-between ${
                      isSelected
                        ? 'bg-[#18191c] border-[#00f0ff]/70 shadow-[0_0_12px_rgba(0,240,255,0.08)]'
                        : 'bg-[#111214] hover:bg-[#16171a] border-[#1f2024] hover:border-[#35363c]'
                    }`}
                  >
                    <div>
                      {/* Thread Title */}
                      <div className="flex items-center gap-2">
                        {thread.isPinned && <Pin className="w-3.5 h-3.5 text-[#00f0ff] shrink-0" />}
                        {thread.isLocked && <Lock className="w-3.5 h-3.5 text-[#e5a50a] shrink-0" />}
                        <h3 className="font-bold text-white text-sm group-hover:text-[#00f0ff] transition-colors line-clamp-1">
                          {thread.title}
                        </h3>
                      </div>

                      {/* Author & Snippet Subline (Matching Screenshot 3) */}
                      <div className="text-xs text-[#949ba4] mt-1 line-clamp-2 leading-relaxed">
                        <span className="font-semibold text-[#23a55a] mr-1.5">
                          {thread.author?.displayName || thread.author?.username}:
                        </span>
                        <span>{thread.snippet || 'Click to view discussion and replies...'}</span>
                      </div>
                    </div>

                    {/* Metadata Footer: Message Count & Timestamp */}
                    <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[#1a1b1e] text-[11px] text-[#80848e]">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 font-mono text-white">
                          <MessageSquare className="w-3 h-3 text-[#00f0ff]" />
                          <span>{thread.transmissionCount}</span>
                        </span>
                        <span>•</span>
                        <span>{formatRelativeTime(thread.lastTransmissionAt || thread.createdAt)}</span>
                      </div>

                      {thread.tags && thread.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          {thread.tags.slice(0, 2).map(tg => (
                            <span key={tg} className="bg-[#16171a] border border-[#1f2024] px-1.5 py-0.2 rounded text-[9px] text-[#00f0ff]">
                              #{tg}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Opened Thread View (Screenshot 4 Split View) */}
        {selectedThread && (
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000] h-full overflow-hidden select-text">
            {/* Top Bar of Opened Thread */}
            <div 
              onContextMenu={(e) => openContextMenu(e, getThreadContextMenu(selectedThread))}
              className="h-12 border-b border-[#141518] bg-[#0b0c0e] px-4 flex items-center justify-between shrink-0 select-none"
            >
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare className="w-4 h-4 text-[#00f0ff] shrink-0" />
                {selectedThread.isPinned && <Pin className="w-3.5 h-3.5 text-[#00f0ff] shrink-0" />}
                {selectedThread.isLocked && <Lock className="w-3.5 h-3.5 text-[#e5a50a] shrink-0" />}
                <h3 className="text-sm font-bold text-white truncate">{selectedThread.title}</h3>
              </div>

              <div className="flex items-center gap-2">
                {canManageThread(selectedThread) && (
                  <button
                    onClick={() => handleToggleThreadLock(selectedThread)}
                    className={`p-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 text-xs px-2.5 py-1 border ${
                      selectedThread.isLocked
                        ? 'border-[#23a55a]/40 bg-[#23a55a]/10 text-[#23a55a] hover:bg-[#23a55a]/20'
                        : 'border-[#e5a50a]/40 bg-[#e5a50a]/10 text-[#e5a50a] hover:bg-[#e5a50a]/20'
                    }`}
                    title={selectedThread.isLocked ? "Unlock Thread" : "Lock Thread"}
                  >
                    {selectedThread.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    <span className="font-semibold text-[11px]">{selectedThread.isLocked ? 'Unlock' : 'Lock'}</span>
                  </button>
                )}
                <button
                  onClick={(e) => openContextMenu(e, getThreadContextMenu(selectedThread))}
                  className="p-1.5 rounded hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white transition-colors cursor-pointer"
                  title="Thread Management Options (Lock / Pin)"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                <button
                  className="p-1.5 rounded hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white transition-colors"
                  title="Follow Thread"
                >
                  <Bell className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedThread(null)}
                  className="p-1.5 rounded hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white transition-colors"
                  title="Close Thread (Restore Board)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Thread Scrollable Messages Stream */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Big Thread Header at Top of Stream (Matching Screenshot 4) */}
              <div className="space-y-2 border-b border-[#1a1b1e] pb-4">
                <div className="w-10 h-10 rounded-[12px] bg-[#16171a] border border-[#1f2024] flex items-center justify-center text-lg">
                  💬
                </div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">{selectedThread.title}</h1>
                <div className="flex items-center gap-2 text-xs text-[#80848e]">
                  <span>Started by <strong className="text-white">@{selectedThread.author?.username}</strong></span>
                  <span>•</span>
                  <span>{new Date(selectedThread.createdAt).toLocaleDateString()}</span>
                  {selectedThread.tags?.map(tg => (
                    <span key={tg} className="bg-[#16171a] border border-[#1f2024] px-1.5 py-0.5 rounded text-[10px] text-[#00f0ff]">
                      #{tg}
                    </span>
                  ))}
                </div>
              </div>

              {/* Transmissions Stream: OP + Replies */}
              <div className="space-y-4">
                {threadTransmissions.map((tx) => {
                  const reactions = threadReactions[tx.id] || [];

                  return (
                    <div
                      key={tx.id}
                      className={`p-3.5 rounded-[8px] transition-colors ${
                        tx.isRoot
                          ? 'bg-[#0e0f12] border border-[#1f2024]'
                          : 'hover:bg-[#0c0d0e]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          onClick={() => onOpenUserProfile?.({ name: tx.authorName, username: tx.authorUsername, avatar: tx.authorAvatar })}
                          className="w-9 h-9 rounded-full bg-[#16171a] border border-[#1f2024] flex items-center justify-center text-sm shrink-0 font-bold text-white cursor-pointer hover:ring-2 hover:ring-[#00f0ff] transition-all"
                        >
                          {tx.authorAvatar}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span 
                              onClick={() => onOpenUserProfile?.({ name: tx.authorName, username: tx.authorUsername, avatar: tx.authorAvatar })}
                              className="font-bold text-white text-xs hover:underline cursor-pointer"
                            >
                              {tx.authorName}
                            </span>
                            {currentUser && tx.authorUsername === currentUser.callsign && (
                              <span className="text-[9px] text-[#00f0ff] font-mono">(You)</span>
                            )}
                            {tx.isRoot && (
                              <span className="bg-[#5865f2] text-white text-[9px] font-bold px-1.5 py-0.2 rounded uppercase">
                                OP
                              </span>
                            )}
                            <span className="text-[10px] text-[#80848e]">
                              {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="text-sm text-[#dbdee1] mt-1.5 leading-relaxed select-text">
                            <MarkdownMessage content={tx.content} />
                          </div>

                          {/* Reaction Pills & React Button */}
                          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                            {reactions.map(r => (
                              <button
                                key={r.emoji}
                                onClick={() => handleToggleReaction(tx.id, r.emoji)}
                                className={`px-2 py-0.5 rounded-[4px] text-xs flex items-center gap-1 border transition-colors ${
                                  r.active
                                    ? 'bg-[#5865f2]/20 border-[#5865f2] text-white'
                                    : 'bg-[#16171a] border-[#1f2024] text-[#949ba4] hover:text-white'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                <span className="font-mono text-[10px]">{r.count}</span>
                              </button>
                            ))}

                            <button
                              onClick={() => handleToggleReaction(tx.id, '👍')}
                              className="px-2 py-0.5 rounded-[4px] bg-[#16171a] hover:bg-[#202226] border border-[#1f2024] text-[11px] text-[#949ba4] hover:text-white flex items-center gap-1 transition-colors"
                            >
                              <Smile className="w-3 h-3 text-[#00f0ff]" />
                              <span>React</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Reply Box (Matching Screenshot 4) */}
            {selectedThread.isLocked ? (
              <div className="p-4 border-t border-[#1a1b1e] bg-[#080809] select-none">
                <div className="bg-[#16171a]/80 border border-[#232529] rounded-[8px] flex items-center justify-center px-4 py-3 text-center min-h-[44px]">
                  <div className="flex items-center gap-2 text-[#80848e] text-xs font-medium">
                    <Lock className="w-3.5 h-3.5 text-[#e5a50a]" />
                    <span>This thread has been locked. You cannot send transmissions.</span>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSendReply} className="p-4 border-t border-[#1a1b1e] bg-[#080809]">
                <div className="bg-[#111214] border border-[#1f2024] focus-within:border-[#00f0ff] rounded-[8px] flex items-center px-3 py-2 gap-2 transition-colors">
                  <input
                    type="text"
                    value={replyInput}
                    onChange={e => setReplyInput(e.target.value)}
                    placeholder={`Send a message in "${selectedThread.title}"...`}
                    className="bg-transparent flex-1 text-xs text-white outline-none placeholder-[#80848e]"
                  />
                  <button
                    type="submit"
                    disabled={!replyInput.trim()}
                    className="text-[#00f0ff] hover:text-[#00f0ff]/80 disabled:opacity-30 transition-colors p-1 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ─── Forum Channel Settings Modal (Inspired by Screenshot 5) ───── */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-3xl h-[85vh] bg-[#0b0c0e] border border-[#1f2024] rounded-[12px] shadow-2xl flex overflow-hidden">
            {/* Modal Left Sidebar */}
            <div className="w-56 bg-[#080809] border-r border-[#1f2024] p-3 flex flex-col justify-between">
              <div className="space-y-1">
                <div className="px-2 py-1.5 text-xs font-bold text-white flex items-center gap-2 border-b border-[#1f2024] pb-2 mb-2 truncate">
                  <MessageSquare className="w-3.5 h-3.5 text-[#00f0ff] shrink-0" />
                  <span className="truncate">#{relayName}</span>
                </div>
                <button className="w-full text-left px-2.5 py-1.5 rounded-[4px] bg-[#1a1b1e] text-white text-xs font-semibold">
                  Overview
                </button>
                <button className="w-full text-left px-2.5 py-1.5 rounded-[4px] text-[#949ba4] hover:bg-[#16171a] hover:text-white text-xs font-semibold transition-colors">
                  Permissions
                </button>
                <button className="w-full text-left px-2.5 py-1.5 rounded-[4px] text-[#949ba4] hover:bg-[#16171a] hover:text-white text-xs font-semibold transition-colors">
                  Invites
                </button>
                <button className="w-full text-left px-2.5 py-1.5 rounded-[4px] text-[#949ba4] hover:bg-[#16171a] hover:text-white text-xs font-semibold transition-colors">
                  Integrations
                </button>
              </div>

              <div>
                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete channel #${relayName}? This action cannot be undone.`)) {
                      onDeleteRelay?.(relayId);
                      setIsSettingsOpen(false);
                    }
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-[#f23f43] hover:bg-[#f23f43]/10 text-xs font-semibold transition-colors"
                >
                  <span>Delete Channel</span>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Modal Right Content (Overview - Screenshot 5) */}
            <div className="flex-1 flex flex-col min-h-0 bg-[#0b0c0e]">
              <div className="h-12 border-b border-[#1f2024] px-6 flex items-center justify-between shrink-0">
                <h3 className="text-sm font-bold text-white">Overview</h3>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1 rounded hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Channel Name */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                    Channel Name
                  </label>
                  <input
                    type="text"
                    value={settingsChannelName}
                    onChange={e => setSettingsChannelName(e.target.value)}
                    className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
                  />
                </div>

                {/* Post Guidelines */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                    Post Guidelines
                  </label>
                  {/* Markdown Toolbar (Screenshot 5) */}
                  <div className="bg-[#111214] border border-[#1f2024] rounded-t-[6px] px-2 py-1 flex items-center gap-1 text-[#949ba4]">
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + ' **bold**')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Bold"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + ' *italic*')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Italic"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + ' __underline__')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Underline"
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + ' ~~strikethrough~~')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Strikethrough"
                    >
                      <Strikethrough className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + '\n> quote')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Quote"
                    >
                      <Quote className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + ' `code`')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Code"
                    >
                      <Code className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostGuidelines(p => p + ' ||spoiler||')}
                      className="p-1 hover:text-white rounded hover:bg-[#1f2024]"
                      title="Spoiler"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={postGuidelines}
                    onChange={e => setPostGuidelines(e.target.value)}
                    rows={4}
                    maxLength={4096}
                    placeholder="Let everyone know how to use this channel!"
                    className="w-full bg-[#111214] border border-[#1f2024] border-t-0 rounded-b-[6px] p-3 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none leading-relaxed"
                  />
                  <div className="flex justify-end text-[10px] text-[#80848e]">
                    <span>{postGuidelines.length} / 4096</span>
                  </div>
                </div>

                {/* Tags Management */}
                <div className="space-y-2 pt-2 border-t border-[#1f2024]">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white">
                      Tags
                    </label>
                    <p className="text-xs text-[#949ba4] mt-0.5">
                      Help people organize their posts into subcategories by creating tags.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {forumTags.map(tg => (
                      <span
                        key={tg}
                        className="bg-[#16171a] border border-[#1f2024] px-2.5 py-1 rounded-[6px] text-xs text-[#00f0ff] flex items-center gap-1.5 group"
                      >
                        <span>#{tg}</span>
                        <button
                          onClick={() => handleRemoveTag(tg)}
                          className="text-[#80848e] hover:text-[#f23f43] transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}

                    {isCreatingTag ? (
                      <div className="flex items-center gap-1 bg-[#111214] border border-[#00f0ff] rounded-[6px] px-2 py-0.5">
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={e => setNewTagInput(e.target.value)}
                          placeholder="tag-name"
                          className="bg-transparent text-xs text-white outline-none w-24"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleAddTag();
                            if (e.key === 'Escape') setIsCreatingTag(false);
                          }}
                        />
                        <button onClick={handleAddTag} className="text-[#23a55a] hover:text-white">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setIsCreatingTag(false)} className="text-[#80848e] hover:text-white">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsCreatingTag(true)}
                        className="px-3 py-1 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded-[6px] transition-colors flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create Tag</span>
                      </button>
                    )}
                  </div>

                  <label className="flex items-center gap-2 pt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireTags}
                      onChange={e => setRequireTags(e.target.checked)}
                      className="accent-[#5865f2] rounded"
                    />
                    <span className="text-xs text-[#dbdee1]">Require people to select tags when posting</span>
                  </label>
                </div>

                {/* Default Reaction */}
                <div className="space-y-2 pt-2 border-t border-[#1f2024]">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white">
                      Default Reaction
                    </label>
                    <p className="text-xs text-[#949ba4] mt-0.5">
                      Pick a default emoji that your members will use to react to a post from this channel.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsReactionPickerOpen(p => !p)}
                      className="px-4 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded-[6px] transition-colors"
                    >
                      Select Emoji ({defaultReaction})
                    </button>

                    {isReactionPickerOpen && (
                      <div className="flex items-center gap-1 bg-[#111214] border border-[#1f2024] p-1.5 rounded-[6px]">
                        {['👍', '❤️', '🚀', '⚡', '🔥', '🎉'].map(em => (
                          <button
                            key={em}
                            onClick={() => {
                              setDefaultReaction(em);
                              setIsReactionPickerOpen(false);
                            }}
                            className="w-7 h-7 flex items-center justify-center hover:bg-[#1f2024] rounded text-base"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Slowmode */}
                <div className="space-y-3 pt-2 border-t border-[#1f2024]">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white">
                      Slowmode
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs text-[#949ba4]">Posts Slowmode</span>
                      <select
                        value={postsSlowmode}
                        onChange={e => setPostsSlowmode(e.target.value)}
                        className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                      >
                        <option value="off">Off</option>
                        <option value="5s">5 seconds</option>
                        <option value="1m">1 minute</option>
                        <option value="5m">5 minutes</option>
                        <option value="15m">15 minutes</option>
                        <option value="1h">1 hour</option>
                      </select>
                      <p className="text-[10px] text-[#80848e]">Interval between creating new threads.</p>
                    </div>

                    <div className="space-y-1">
                      <span className="text-xs text-[#949ba4]">Messages Slowmode</span>
                      <select
                        value={messagesSlowmode}
                        onChange={e => setMessagesSlowmode(e.target.value)}
                        className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00f0ff]"
                      >
                        <option value="off">Off</option>
                        <option value="5s">5 seconds</option>
                        <option value="1m">1 minute</option>
                        <option value="5m">5 minutes</option>
                        <option value="15m">15 minutes</option>
                      </select>
                      <p className="text-[10px] text-[#80848e]">Interval between replies within a thread.</p>
                    </div>
                  </div>
                </div>

                {/* Save Changes Button */}
                <div className="pt-4 border-t border-[#1f2024] flex items-center justify-between">
                  <span className="text-xs text-[#23a55a]">
                    {settingsSaved && '✓ Forum channel settings applied'}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsSettingsOpen(false)}
                      className="px-4 py-2 text-xs text-[#949ba4] hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        onUpdateRelayTopic?.(postGuidelines);
                        setSettingsSaved(true);
                        setTimeout(() => {
                          setSettingsSaved(false);
                          setIsSettingsOpen(false);
                        }, 800);
                      }}
                      className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded-[6px] transition-colors"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-[#111214] border border-[#00f0ff]/40 text-[#dbdee1] px-4 py-2.5 rounded-[8px] text-xs shadow-2xl z-50 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
          <span className="w-2 h-2 rounded-full bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
