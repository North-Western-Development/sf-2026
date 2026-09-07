import React, { useState, useEffect } from 'react';
import { 
  HardDrive, 
  Upload, 
  Trash2, 
  Download, 
  Copy, 
  FileText, 
  Image as ImageIcon, 
  Film, 
  Music, 
  Archive, 
  CheckCircle2, 
  Search
} from 'lucide-react';
import { Modal } from '@subspace/ui';
import { api, VaultFile, VaultQuota } from './services/api';

interface SubspaceVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertAttachmentTag?: (tag: string) => void;
  onRequestDisclaimer?: (file: File) => void;
}

export const SubspaceVaultModal: React.FC<SubspaceVaultModalProps> = ({
  isOpen,
  onClose,
  onInsertAttachmentTag,
  onRequestDisclaimer,
}) => {
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [quota, setQuota] = useState<VaultQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'audio' | 'doc'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadVaultData = async () => {
    setLoading(true);
    try {
      const [quotaData, filesData] = await Promise.all([
        api.getVaultQuota().catch(() => null),
        api.getVaultFiles().catch(() => []),
      ]);
      if (quotaData) setQuota(quotaData);
      setFiles(filesData);
    } catch (err) {
      console.warn('Failed to load Subspace Vault contents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadVaultData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await api.uploadVaultFile(file);
      await loadVaultData();
    } catch (err: any) {
      if (err.code === 'DISCLAIMER_REQUIRED' && onRequestDisclaimer) {
        onRequestDisclaimer(file);
      } else {
        alert(`Vault upload failed: ${err.message}`);
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file from your Subspace Vault?')) return;
    try {
      await api.deleteVaultFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      if (quota) {
        api.getVaultQuota().then(setQuota).catch(() => {});
      }
    } catch (err: any) {
      alert(`Failed to delete file: ${err.message}`);
    }
  };

  const handleCopyLink = (file: VaultFile) => {
    const directUrl = file.downloadUrl 
      ? `${window.location.origin}${file.downloadUrl}` 
      : `${window.location.origin}/api/v1/vault/files/${file.id}/download`;
    navigator.clipboard.writeText(directUrl);
    setCopiedId(file.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleInsertTag = (file: VaultFile) => {
    const sizeKB = (Number(file.sizeBytes) / 1024).toFixed(1);
    const downloadUrl = file.downloadUrl || `/api/v1/vault/files/${file.id}/download`;
    const tag = `[Attachment: ${file.filename} (${sizeKB} KB)|${downloadUrl}]`;
    if (onInsertAttachmentTag) {
      onInsertAttachmentTag(tag);
      onClose();
    }
  };

  const formatBytes = (bytes: number | string) => {
    const b = Number(bytes);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-[#00f0ff]" />;
    if (mimeType.startsWith('video/')) return <Film className="w-4 h-4 text-[#eb459e]" />;
    if (mimeType.startsWith('audio/')) return <Music className="w-4 h-4 text-[#5865f2]" />;
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compressed')) {
      return <Archive className="w-4 h-4 text-[#e5a50a]" />;
    }
    return <FileText className="w-4 h-4 text-[#949ba4]" />;
  };

  const filteredFiles = files.filter(f => {
    const matchesSearch = f.filename.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterType === 'image') return f.mimeType.startsWith('image/');
    if (filterType === 'video') return f.mimeType.startsWith('video/');
    if (filterType === 'audio') return f.mimeType.startsWith('audio/');
    if (filterType === 'doc') return !f.mimeType.startsWith('image/') && !f.mimeType.startsWith('video/') && !f.mimeType.startsWith('audio/');
    return true;
  });

  const usedPercent = quota && quota.quotaBytes > 0 
    ? Math.min(100, Math.round((quota.usedBytes / quota.quotaBytes) * 100)) 
    : 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Subspace Vault — Personal File Drive" fixedDimensions={true}>
      <div className="flex flex-col h-full min-h-0 text-xs text-[#dbdee1] select-none">
        {/* Quota Usage Bar & Top Actions */}
        <div className="bg-[#0b0c0e] border border-[#1f2024] p-4 rounded-[8px] mb-4 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[#00f0ff]" />
              <span className="font-semibold text-white text-sm">Storage Allocation</span>
              <span className="text-[10px] font-mono text-[#949ba4] bg-[#16171a] px-2 py-0.5 rounded">
                Personal Quota
              </span>
            </div>
            <label className="bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-black font-semibold px-3 py-1.5 rounded-[4px] cursor-pointer flex items-center gap-1.5 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Uploading...' : 'Upload File'}</span>
              <input type="file" onChange={handleFileUpload} className="hidden" disabled={uploading} />
            </label>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="h-2 w-full bg-[#16171a] rounded-full overflow-hidden border border-[#1f2024]">
              <div 
                className="h-full bg-gradient-to-r from-[#00f0ff] to-[#5865f2] transition-all duration-300"
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-[#949ba4]">
              <span>
                {quota ? `${formatBytes(quota.usedBytes)} used of ${formatBytes(quota.quotaBytes)}` : 'Loading quota...'}
              </span>
              <span>{usedPercent}% used ({quota ? quota.fileCount : files.length} files)</span>
            </div>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
          <div className="flex items-center gap-1 bg-[#0b0c0e] border border-[#1f2024] p-1 rounded-[6px]">
            {(['all', 'image', 'video', 'audio', 'doc'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterType(tab)}
                className={`px-2.5 py-1 rounded-[4px] capitalize transition-colors ${
                  filterType === tab ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:text-white'
                }`}
              >
                {tab === 'all' ? 'All Objects' : `${tab}s`}
              </button>
            ))}
          </div>

          <div className="flex-1 max-w-xs relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#80848e]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search files by name..."
              className="w-full bg-[#0b0c0e] border border-[#1f2024] rounded-[6px] pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
            />
          </div>
        </div>

        {/* File List / Grid */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0 select-text">
          {loading ? (
            <div className="text-center py-16 text-[#949ba4]">Loading encrypted storage records...</div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-16 text-[#949ba4] bg-[#080809] border border-[#1f2024] rounded-[8px]">
              <HardDrive className="w-8 h-8 text-[#3f4147] mx-auto mb-2" />
              <p className="font-semibold text-white">No files found</p>
              <p className="text-[11px] mt-1">Upload direct attachments or tether cloud drives to your personal Subspace Vault.</p>
            </div>
          ) : (
            filteredFiles.map(file => (
              <div
                key={file.id}
                className="bg-[#0b0c0e] hover:bg-[#111214] border border-[#1f2024] hover:border-[#35363c] rounded-[8px] p-3 flex items-center justify-between transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-[6px] bg-[#16171a] border border-[#1f2024] flex items-center justify-center shrink-0">
                    {getFileIcon(file.mimeType)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-white text-xs truncate max-w-sm flex items-center gap-2">
                      <span className="truncate">{file.filename}</span>
                      {file.isQuarantined && (
                        <span className="bg-[#f23f43]/20 border border-[#f23f43] text-[#f23f43] text-[9px] font-bold px-1.5 py-0.2 rounded uppercase">
                          Quarantined
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#80848e] flex items-center gap-2 mt-0.5">
                      <span>{formatBytes(file.sizeBytes)}</span>
                      <span>•</span>
                      <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span className="font-mono text-[#00f0ff]">{file.mimeType}</span>
                    </div>
                  </div>
                </div>

                {/* File Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {onInsertAttachmentTag && (
                    <button
                      onClick={() => handleInsertTag(file)}
                      className="bg-[#1f2024] hover:bg-[#2b2d31] text-white px-2.5 py-1 rounded-[4px] text-[11px] font-medium transition-colors"
                      title="Insert tag into message draft"
                    >
                      Attach
                    </button>
                  )}
                  <button
                    onClick={() => handleCopyLink(file)}
                    className="p-1.5 rounded-[4px] bg-[#16171a] hover:bg-[#1f2024] text-[#949ba4] hover:text-white transition-colors"
                    title="Copy direct download link"
                  >
                    {copiedId === file.id ? <CheckCircle2 className="w-4 h-4 text-[#23a55a]" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={file.downloadUrl || `/api/v1/vault/files/${file.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-[4px] bg-[#16171a] hover:bg-[#1f2024] text-[#949ba4] hover:text-white transition-colors"
                    title="Direct Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => handleDeleteFile(file.id)}
                    className="p-1.5 rounded-[4px] bg-[#16171a] hover:bg-[#f23f43]/20 text-[#949ba4] hover:text-[#f23f43] transition-colors"
                    title="Delete file"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
};
