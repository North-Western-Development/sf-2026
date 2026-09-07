import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Pin, 
  Lock, 
  Plus, 
  Search, 
  ChevronRight, 
  Send, 
  ArrowLeft,
  Tag
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';

export interface ArchivalThread {
  id: string;
  title: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  transmissionCount: number;
  lastTransmissionAt: string;
  createdAt: string;
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
}

export const ArchivalForumView: React.FC<ArchivalForumViewProps> = ({
  relayId,
  relayName,
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

  const token = localStorage.getItem('subspace_access_token') || '';

  const loadThreads = async () => {
    setLoading(true);
    try {
      const url = `/api/v1/relays/${relayId}/archival/threads${selectedTag ? `?tag=${encodeURIComponent(selectedTag)}` : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.threads || []).map((t: any) => ({
          ...t.thread,
          author: t.author,
        }));
        setThreads(mapped);
      }
    } catch (err) {
      console.warn('Failed to load archival threads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads();
    setSelectedThread(null);
  }, [relayId, selectedTag]);

  const loadThreadReplies = async (threadId: string) => {
    try {
      const res = await fetch(`/api/v1/relays/${relayId}/archival/threads/${threadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const root = data.rootTransmission ? [{
          id: data.rootTransmission.id,
          content: data.rootTransmission.content,
          createdAt: data.rootTransmission.createdAt,
          authorName: data.thread?.author?.displayName || 'Author',
          authorAvatar: data.thread?.author?.avatarUrl || '📜',
          isRoot: true,
        }] : [];
        const replies = (data.replies || []).map((r: any) => ({
          id: r.id,
          content: r.content,
          createdAt: r.createdAt,
          authorName: r.authorName || 'Transmitter',
          authorAvatar: r.authorAvatar || '⚡',
        }));
        setThreadTransmissions([...root, ...replies]);
      }
    } catch (err) {
      console.warn('Failed to load replies:', err);
    }
  };

  const handleSelectThread = (thread: ArchivalThread) => {
    setSelectedThread(thread);
    loadThreadReplies(thread.id);
  };

  const handleCreateThreadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    try {
      const tagsArray = newTags
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      const res = await fetch(`/api/v1/relays/${relayId}/archival/threads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent.trim(),
          tags: tagsArray,
        }),
      });

      if (res.ok) {
        setNewTitle('');
        setNewContent('');
        setNewTags('');
        setIsCreatingThread(false);
        loadThreads();
      }
    } catch (err: any) {
      alert(`Failed to create archival thread: ${err.message}`);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedThread || !replyInput.trim()) return;

    try {
      const res = await fetch(`/api/v1/relays/${relayId}/archival/threads/${selectedThread.id}/transmissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: replyInput.trim() }),
      });

      if (res.ok) {
        setReplyInput('');
        loadThreadReplies(selectedThread.id);
        setThreads(prev => prev.map(t => t.id === selectedThread.id ? { ...t, transmissionCount: t.transmissionCount + 1 } : t));
      }
    } catch (err: any) {
      alert(`Failed to post reply: ${err.message}`);
    }
  };

  const allTags = Array.from(new Set(threads.flatMap(t => t.tags || [])));
  const filteredThreads = threads.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-[#000000] text-[#dbdee1] min-w-0 select-none">
      {/* Forum Header */}
      <div className="h-12 border-b border-[#1f2024] bg-[#080809] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {selectedThread ? (
            <button
              onClick={() => setSelectedThread(null)}
              className="flex items-center gap-1 text-xs text-[#949ba4] hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to #{relayName}</span>
            </button>
          ) : (
            <>
              <MessageSquare className="w-5 h-5 text-[#00f0ff]" />
              <h2 className="text-sm font-bold text-white tracking-wide">#{relayName}</h2>
              <span className="text-[11px] text-[#80848e] font-mono">Archival Forum</span>
            </>
          )}
        </div>

        {!selectedThread && (
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#80848e]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search threads..."
                className="bg-[#111214] border border-[#1f2024] rounded-[6px] pl-8 pr-3 py-1 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] w-48"
              />
            </div>
            <button
              onClick={() => setIsCreatingThread(true)}
              className="bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-black text-xs font-semibold px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New Flight Thread
            </button>
          </div>
        )}
      </div>

      {/* Main Forum Stage */}
      <div className="flex-1 flex min-h-0">
        {selectedThread ? (
          /* Active Thread View */
          <div className="flex-1 flex flex-col min-w-0 bg-[#000000]">
            {/* Thread Title Bar */}
            <div className="p-4 border-b border-[#1f2024] bg-[#0b0c0e] flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {selectedThread.isPinned && <Pin className="w-3.5 h-3.5 text-[#00f0ff]" />}
                  {selectedThread.isLocked && <Lock className="w-3.5 h-3.5 text-[#e5a50a]" />}
                  <h1 className="text-base font-bold text-white">{selectedThread.title}</h1>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-[#80848e]">
                  <span>Started by <strong className="text-white">@{selectedThread.author?.username}</strong></span>
                  <span>•</span>
                  <span>{new Date(selectedThread.createdAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-1 ml-2">
                    {selectedThread.tags?.map(tg => (
                      <span key={tg} className="bg-[#16171a] border border-[#1f2024] px-1.5 py-0.5 rounded text-[10px] text-[#00f0ff]">
                        #{tg}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Replies Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
              {threadTransmissions.map((tx) => (
                <div key={tx.id} className="bg-[#0b0c0e] border border-[#1f2024] p-3 rounded-[8px] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-black border border-[#1f2024] flex items-center justify-center text-xs">
                        {tx.authorAvatar}
                      </div>
                      <span className="font-semibold text-white">{tx.authorName}</span>
                      {tx.isRoot && (
                        <span className="bg-[#5865f2] text-white text-[9px] font-bold px-1.5 py-0.2 rounded uppercase">
                          Original Poster
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#80848e]">{new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="text-sm text-[#dbdee1] leading-relaxed">
                    <MarkdownMessage content={tx.content} />
                  </div>
                </div>
              ))}
            </div>

            {/* Thread Reply Box */}
            <form onSubmit={handleSendReply} className="p-4 border-t border-[#1f2024] bg-[#080809]">
              <div className="bg-[#111214] border border-[#1f2024] focus-within:border-[#00f0ff]/50 rounded-[8px] flex items-center px-3 py-2 gap-2">
                <input
                  type="text"
                  value={replyInput}
                  onChange={e => setReplyInput(e.target.value)}
                  placeholder={`Reply in thread "${selectedThread.title}"...`}
                  className="bg-transparent flex-1 text-xs text-white outline-none placeholder-[#80848e]"
                />
                <button type="submit" disabled={!replyInput.trim()} className="text-[#00f0ff] disabled:opacity-30">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Forum Threads List */
          <div className="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full overflow-y-auto">
            {/* Tag Pills Filter */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-3 py-1 rounded-[4px] text-xs transition-colors ${
                    selectedTag === null ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:text-white bg-[#0b0c0e] border border-[#1f2024]'
                  }`}
                >
                  All Tags
                </button>
                {allTags.map(tg => (
                  <button
                    key={tg}
                    onClick={() => setSelectedTag(tg)}
                    className={`px-3 py-1 rounded-[4px] text-xs transition-colors flex items-center gap-1 ${
                      selectedTag === tg ? 'bg-[#00f0ff] text-black font-semibold' : 'text-[#949ba4] hover:text-white bg-[#0b0c0e] border border-[#1f2024]'
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    <span>#{tg}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Create Thread Modal or Inline Composer */}
            {isCreatingThread && (
              <form onSubmit={handleCreateThreadSubmit} className="bg-[#0b0c0e] border border-[#00f0ff]/30 p-5 rounded-[12px] mb-6 space-y-3 shadow-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Publish Archival Thread</h3>
                  <button type="button" onClick={() => setIsCreatingThread(false)} className="text-xs text-[#949ba4] hover:text-white">Cancel</button>
                </div>

                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Thread Title (e.g. Mission Debrief: Sector 4 Handshake)"
                  className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
                />

                <textarea
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder="Initial flight transmission content (Markdown supported)..."
                  className="w-full h-28 bg-[#111214] border border-[#1f2024] rounded-[6px] p-3 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff] resize-none"
                />

                <input
                  type="text"
                  value={newTags}
                  onChange={e => setNewTags(e.target.value)}
                  placeholder="Tags (comma separated, e.g. debrief, orbital, telemetry)"
                  className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
                />

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-black text-xs font-semibold px-4 py-2 rounded-[4px] transition-colors"
                  >
                    Publish Thread
                  </button>
                </div>
              </form>
            )}

            {/* Thread Cards Grid */}
            <div className="space-y-2">
              {filteredThreads.length === 0 ? (
                <div className="text-center py-16 text-[#949ba4] bg-[#080809] border border-[#1f2024] rounded-[8px]">
                  <MessageSquare className="w-8 h-8 text-[#3f4147] mx-auto mb-2" />
                  <p className="font-semibold text-white">No archival flight threads yet</p>
                  <p className="text-[11px] mt-1">Start a mission briefing, debrief, or research topic in this Archival Relay.</p>
                </div>
              ) : (
                filteredThreads.map(thread => (
                  <div
                    key={thread.id}
                    onClick={() => handleSelectThread(thread)}
                    className="bg-[#0b0c0e] hover:bg-[#111214] border border-[#1f2024] hover:border-[#35363c] rounded-[8px] p-4 flex items-center justify-between cursor-pointer transition-all group"
                  >
                    <div className="space-y-1.5 min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        {thread.isPinned && <Pin className="w-3.5 h-3.5 text-[#00f0ff]" />}
                        {thread.isLocked && <Lock className="w-3.5 h-3.5 text-[#e5a50a]" />}
                        <h3 className="font-bold text-white text-sm group-hover:text-[#00f0ff] transition-colors truncate">
                          {thread.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#80848e]">
                        <span>By <strong className="text-white">@{thread.author?.username}</strong></span>
                        <span>•</span>
                        <span>Updated {new Date(thread.lastTransmissionAt).toLocaleDateString()}</span>
                        {thread.tags && thread.tags.length > 0 && (
                          <div className="flex items-center gap-1 ml-2">
                            {thread.tags.map(tg => (
                              <span key={tg} className="bg-[#16171a] border border-[#1f2024] px-1.5 py-0.2 rounded text-[10px] text-[#00f0ff]">
                                #{tg}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1 bg-[#16171a] border border-[#1f2024] px-2.5 py-1 rounded-[6px] text-xs font-mono text-white">
                        <MessageSquare className="w-3.5 h-3.5 text-[#00f0ff]" />
                        <span>{thread.transmissionCount}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#80848e] group-hover:text-white transition-colors" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
