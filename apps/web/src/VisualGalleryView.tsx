import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  Upload, 
  Download, 
  Maximize2, 
  X, 
  ExternalLink, 
  Send
} from 'lucide-react';
import { api } from './services/api';

export interface VisualItem {
  id: string;
  url: string;
  filename: string;
  caption: string;
  authorName: string;
  authorUsername: string;
  createdAt: string;
  sizeFormatted: string;
}

interface VisualGalleryViewProps {
  relayId: string;
  relayName: string;
  currentUser?: any;
  onRequestDisclaimer?: (file: File) => void;
}

export const VisualGalleryView: React.FC<VisualGalleryViewProps> = ({
  relayId,
  relayName,
  onRequestDisclaimer,
}) => {
  const [items, setItems] = useState<VisualItem[]>([]);
  const [activeLightbox, setActiveLightbox] = useState<VisualItem | null>(null);
  const [captionInput, setCaptionInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadVisuals = async () => {
    setLoading(true);
    try {
      const res = await api.request(`/api/v1/relays/${relayId}/visual/gallery`);
      if (res.ok) {
        const data = await res.json();
        const mapped: VisualItem[] = (data.gallery || []).map((g: any, i: number) => ({
          id: `${g.transmissionId}-${g.attachment?.id || i}`,
          url: g.attachment?.url,
          filename: g.attachment?.filename || 'Visual Artifact',
          caption: g.caption || '',
          authorName: g.author?.displayName || g.author?.username || 'Transmitter',
          authorUsername: g.author?.username || 'transmitter',
          createdAt: g.createdAt,
          sizeFormatted: g.attachment?.size ? `${(g.attachment.size / 1024).toFixed(1)} KB` : 'Media',
        }));
        setItems(mapped);
      }
    } catch (err) {
      console.warn('Failed to load visual gallery transmissions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVisuals();
  }, [relayId]);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
    e.target.value = '';
  };

  const handleBroadcastVisual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    try {
      const vaultFile = await api.uploadVaultFile(selectedFile);
      const res = await api.request(`/api/v1/relays/${relayId}/visual/transmissions`, {
        method: 'POST',
        body: JSON.stringify({
          content: captionInput.trim(),
          attachments: [{
            id: vaultFile.id,
            url: vaultFile.downloadUrl || `/api/v1/vault/files/${vaultFile.id}/download`,
            filename: selectedFile.name,
            size: selectedFile.size,
          }],
        }),
      });

      if (res.ok) {
        setSelectedFile(null);
        setCaptionInput('');
        loadVisuals();
      }
    } catch (err: any) {
      if (err.code === 'DISCLAIMER_REQUIRED' && onRequestDisclaimer && selectedFile) {
        onRequestDisclaimer(selectedFile);
      } else {
        alert(`Failed to broadcast visual artifact: ${err.message}`);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#000000] text-[#dbdee1] min-w-0 select-none">
      {/* Gallery Header */}
      <div className="h-12 border-b border-[#1f2024] bg-[#080809] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-[#eb459e]" />
          <h2 className="text-sm font-bold text-white tracking-wide">#{relayName}</h2>
          <span className="text-[11px] text-[#80848e] font-mono">Visual Media Grid</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="bg-[#1f2024] hover:bg-[#2b2d31] text-white text-xs font-semibold px-3 py-1.5 rounded-[4px] cursor-pointer flex items-center gap-1.5 transition-colors">
            <Upload className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>Select Media</span>
            <input type="file" accept="image/*,video/*" onChange={handleFileSelected} className="hidden" />
          </label>
        </div>
      </div>

      {/* Broadcast Media Banner (if file selected) */}
      {selectedFile && (
        <form onSubmit={handleBroadcastVisual} className="p-4 bg-[#0b0c0e] border-b border-[#00f0ff]/30 flex items-center gap-3 shrink-0">
          <div className="text-xs text-[#00f0ff] font-semibold truncate max-w-xs">
            📎 {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
          </div>
          <input
            type="text"
            value={captionInput}
            onChange={e => setCaptionInput(e.target.value)}
            placeholder="Add descriptive caption or observation notes..."
            className="flex-1 bg-[#111214] border border-[#1f2024] rounded-[6px] px-3 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
          />
          <button
            type="submit"
            disabled={uploading}
            className="bg-[#eb459e] hover:bg-[#eb459e]/80 text-white text-xs font-semibold px-4 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{uploading ? 'Broadcasting...' : 'Broadcast to Gallery'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedFile(null)}
            className="text-xs text-[#949ba4] hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Media Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center py-20 text-[#949ba4]">Loading visual artifacts...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-[#949ba4] bg-[#080809] border border-[#1f2024] rounded-[12px] max-w-lg mx-auto">
            <Camera className="w-10 h-10 text-[#3f4147] mx-auto mb-2" />
            <h3 className="text-white font-bold text-sm">This relay is currently empty</h3>
            <p className="text-xs mt-1 text-[#80848e]">
              Be the first to send something over the air!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map(item => (
              <div
                key={item.id}
                onClick={() => setActiveLightbox(item)}
                className="group relative aspect-video bg-[#0b0c0e] border border-[#1f2024] hover:border-[#00f0ff]/50 rounded-[10px] overflow-hidden cursor-pointer transition-all shadow-lg"
              >
                <img
                  src={item.url}
                  alt={item.filename}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e: any) => {
                    e.target.src = 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=600&q=80';
                  }}
                />

                {/* Overlay Metadata */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                  <div className="font-semibold text-white text-xs truncate">{item.caption || item.filename}</div>
                  <div className="text-[10px] text-[#00f0ff] flex items-center justify-between mt-1">
                    <span>@{item.authorUsername}</span>
                    <Maximize2 className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {activeLightbox && (
        <div 
          className="fixed inset-0 z-[999999] bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
          onClick={() => setActiveLightbox(null)}
        >
          <div 
            className="max-w-4xl w-full max-h-[90vh] bg-[#0b0c0e] border border-[#1f2024] rounded-[16px] overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="h-12 border-b border-[#1f2024] px-4 flex items-center justify-between shrink-0 bg-[#080809]">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-[#00f0ff]" />
                <span className="font-bold text-white text-xs">{activeLightbox.filename}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={activeLightbox.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded hover:bg-[#1f2024] text-[#949ba4] hover:text-white"
                  title="Open Original"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setActiveLightbox(null)}
                  className="p-1.5 rounded hover:bg-[#1f2024] text-[#949ba4] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-black flex items-center justify-center p-2">
              <img
                src={activeLightbox.url}
                alt={activeLightbox.filename}
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div>

            <div className="p-4 bg-[#0b0c0e] border-t border-[#1f2024] flex items-center justify-between text-xs">
              <div>
                <p className="text-white font-medium">{activeLightbox.caption || 'No caption provided.'}</p>
                <div className="text-[11px] text-[#80848e] mt-1">
                  Captured by <strong className="text-white">@{activeLightbox.authorUsername}</strong> • {new Date(activeLightbox.createdAt).toLocaleString()}
                </div>
              </div>
              <a
                href={activeLightbox.url}
                download={activeLightbox.filename}
                className="bg-[#1f2024] hover:bg-[#2b2d31] text-white px-3 py-1.5 rounded-[4px] flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
