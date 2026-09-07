import React, { useState, useEffect } from 'react';
import { 
  ExternalLink, 
  FileText, 
  Image as ImageIcon, 
  Check, 
  Search, 
  ShieldCheck, 
  Sparkles, 
  Link2
} from 'lucide-react';
import { Modal } from '@subspace/ui';
import { api, CloudIntegration } from './services/api';

export interface CloudTetherItem {
  provider: 'google' | 'onedrive' | 'dropbox';
  title: string;
  url: string;
  mimeType: string;
  sizeFormatted: string;
  thumbnailUrl?: string;
}

interface CloudDrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTether: (tether: CloudTetherItem) => void;
}

export const CloudDrivePickerModal: React.FC<CloudDrivePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectTether,
}) => {
  const [activeTab, setActiveTab] = useState<'google' | 'onedrive' | 'dropbox'>('google');
  const [integrations, setIntegrations] = useState<Record<string, CloudIntegration>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      api.getCloudIntegrations().then(setIntegrations).catch(() => {});
    }
  }, [isOpen]);

  // Curated mock drive files per provider for realistic OAuth2 Picker simulation
  const mockDriveFiles: Record<'google' | 'onedrive' | 'dropbox', Array<{
    id: string;
    title: string;
    url: string;
    mimeType: string;
    sizeFormatted: string;
    updatedAt: string;
  }>> = {
    google: [
      {
        id: 'g-1',
        title: 'Quantum Navigation Telemetry.gdoc',
        url: 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing',
        mimeType: 'application/vnd.google-apps.document',
        sizeFormatted: '1.4 MB',
        updatedAt: '2 hours ago',
      },
      {
        id: 'g-2',
        title: 'Fleet Relay Architecture 2026.pdf',
        url: 'https://drive.google.com/file/d/1s0f_relays_arch_2026_subspace/view?usp=sharing',
        mimeType: 'application/pdf',
        sizeFormatted: '8.2 MB',
        updatedAt: 'Yesterday',
      },
      {
        id: 'g-3',
        title: 'Deep Space Nebula Spectrography.png',
        url: 'https://drive.google.com/file/d/1nebula_spectra_highres_img/view?usp=sharing',
        mimeType: 'image/png',
        sizeFormatted: '4.7 MB',
        updatedAt: '3 days ago',
      },
    ],
    onedrive: [
      {
        id: 'o-1',
        title: 'Orbital Logistics Manifest.xlsx',
        url: 'https://1drv.ms/x/s!Akz98SubspaceManifest2026',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeFormatted: '2.1 MB',
        updatedAt: 'Today at 08:30',
      },
      {
        id: 'o-2',
        title: 'Clearance Protocols Master Deck.pptx',
        url: 'https://1drv.ms/p/s!Akz98ClearanceProtocolsMaster',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sizeFormatted: '15.4 MB',
        updatedAt: 'Oct 14',
      },
      {
        id: 'o-3',
        title: 'Telemetry Encryption Keys.docx',
        url: 'https://1drv.ms/w/s!Akz98TelemetryEncryptionDoc',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeFormatted: '512 KB',
        updatedAt: 'Last week',
      },
    ],
    dropbox: [
      {
        id: 'd-1',
        title: 'LiveKit SFU Codec Profiles.zip',
        url: 'https://www.dropbox.com/s/subspace_livekit_codecs.zip?dl=0',
        mimeType: 'application/zip',
        sizeFormatted: '24.8 MB',
        updatedAt: '4 hours ago',
      },
      {
        id: 'd-2',
        title: 'Subspace Audio Waveform Sample.flac',
        url: 'https://www.dropbox.com/s/subspace_quantum_pulse.flac?dl=0',
        mimeType: 'audio/flac',
        sizeFormatted: '38.0 MB',
        updatedAt: 'Nov 02',
      },
      {
        id: 'd-3',
        title: 'Beacon Cluster Topology Diagram.svg',
        url: 'https://www.dropbox.com/s/beacon_topology_vector.svg?dl=0',
        mimeType: 'image/svg+xml',
        sizeFormatted: '850 KB',
        updatedAt: 'Last month',
      },
    ],
  };

  const activeIntegration = integrations[activeTab] || {
    provider: activeTab,
    name: activeTab === 'google' ? 'Google Drive' : activeTab === 'onedrive' ? 'Microsoft OneDrive' : 'Dropbox',
    isEnabled: true,
  };

  const currentFiles = (mockDriveFiles[activeTab] || []).filter(f =>
    f.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleConfirmSelected = () => {
    const selected = mockDriveFiles[activeTab]?.find(f => f.id === selectedFileId);
    if (selected) {
      onSelectTether({
        provider: activeTab,
        title: selected.title,
        url: selected.url,
        mimeType: selected.mimeType,
        sizeFormatted: selected.sizeFormatted,
      });
      onClose();
      return;
    }

    if (customUrl.trim()) {
      onSelectTether({
        provider: activeTab,
        title: customTitle.trim() || `${activeIntegration.name} File`,
        url: customUrl.trim(),
        mimeType: 'application/octet-stream',
        sizeFormatted: 'Cloud Tether',
      });
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tether External Cloud Drive">
      <div className="space-y-4 text-xs select-none">
        {/* Compliance & Privacy Banner */}
        <div className="bg-[#111214] border border-[#1f2024] rounded-[8px] p-3 flex items-start gap-2.5 text-[#949ba4]">
          <ShieldCheck className="w-4 h-4 text-[#00f0ff] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-white">Direct OAuth2 Cloud Tethering</span>
            <p className="text-[11px] leading-relaxed text-[#dbdee1]">
              Subspace Frequency does not transfer or re-host your cloud files. Files remain secured in your provider's drive and are rendered via rich interactive embeds.
            </p>
          </div>
        </div>

        {/* Provider Tabs */}
        <div className="grid grid-cols-3 gap-2">
          {(['google', 'onedrive', 'dropbox'] as const).map((prov) => {
            const isSelected = activeTab === prov;
            const meta = {
              google: { label: 'Google Drive', color: '#4285F4', icon: '📁' },
              onedrive: { label: 'OneDrive', color: '#0078D4', icon: '☁️' },
              dropbox: { label: 'Dropbox', color: '#0061FF', icon: '📦' },
            }[prov];

            return (
              <button
                key={prov}
                type="button"
                onClick={() => {
                  setActiveTab(prov);
                  setSelectedFileId(null);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-[8px] border transition-all text-left ${
                  isSelected
                    ? 'bg-[#16171a] border-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.15)] text-white'
                    : 'bg-[#0b0c0e] border-[#1f2024] hover:bg-[#111214] text-[#949ba4]'
                }`}
              >
                <span className="text-base">{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-xs truncate">{meta.label}</div>
                  <div className="text-[10px] text-[#23a55a] font-mono">Tether Active</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Provider Client Credentials Info */}
        <div className="flex items-center justify-between px-3 py-2 rounded-[6px] bg-[#0b0c0e] border border-[#1f2024] text-[11px]">
          <span className="text-[#949ba4]">OAuth2 Client Identity:</span>
          <span className="font-mono text-[#00f0ff] truncate max-w-[280px]" title={activeIntegration.clientId}>
            {activeIntegration.clientId ? activeIntegration.clientId.slice(0, 24) + '...' : 'Configured'}
          </span>
        </div>

        {/* Search & File Browser */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#949ba4]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeIntegration.name} files...`}
              className="w-full bg-[#111214] border border-[#1f2024] rounded-[6px] pl-8 pr-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
            />
          </div>

          <div className="border border-[#1f2024] rounded-[8px] bg-[#080809] max-h-48 overflow-y-auto divide-y divide-[#1f2024]">
            {currentFiles.length === 0 ? (
              <div className="p-4 text-center text-[#949ba4] text-[11px]">
                No files found in {activeIntegration.name}. Paste a share link below.
              </div>
            ) : (
              currentFiles.map((file) => {
                const isPicked = selectedFileId === file.id;
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      setSelectedFileId(file.id);
                      setCustomUrl('');
                    }}
                    className={`p-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isPicked ? 'bg-[#00f0ff]/10 border-l-2 border-[#00f0ff]' : 'hover:bg-[#111214]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-[6px] bg-[#16171a] flex items-center justify-center text-[#00f0ff] shrink-0 border border-[#1f2024]">
                        {file.mimeType.includes('image') ? (
                          <ImageIcon className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium truncate ${isPicked ? 'text-white font-semibold' : 'text-[#dbdee1]'}`}>
                          {file.title}
                        </div>
                        <div className="text-[10px] text-[#949ba4] flex items-center gap-2">
                          <span>{file.sizeFormatted}</span>
                          <span>•</span>
                          <span>{file.updatedAt}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 text-[#949ba4] hover:text-white"
                        title="Open in provider"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        isPicked ? 'bg-[#00f0ff] border-[#00f0ff] text-black' : 'border-[#3f4147]'
                      }`}>
                        {isPicked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Or Paste Direct Cloud Share Link */}
        <div className="space-y-2 pt-1 border-t border-[#1f2024]">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#dbdee1]">
            <Link2 className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>Or paste shareable link:</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Optional title (e.g. Project Specs)"
              className="bg-[#111214] border border-[#1f2024] rounded-[6px] px-2.5 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
            />
            <input
              type="text"
              value={customUrl}
              onChange={(e) => {
                setCustomUrl(e.target.value);
                setSelectedFileId(null);
              }}
              placeholder={`https://${activeTab === 'google' ? 'drive.google.com/...' : activeTab === 'onedrive' ? '1drv.ms/...' : 'dropbox.com/...'}`}
              className="bg-[#111214] border border-[#1f2024] rounded-[6px] px-2.5 py-1.5 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[#1f2024]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[6px] text-xs font-semibold text-[#dbdee1] hover:bg-[#1a1b1e] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedFileId && !customUrl.trim()}
            onClick={handleConfirmSelected}
            className={`px-4 py-2 rounded-[6px] text-xs font-bold text-black flex items-center gap-1.5 transition-all ${
              selectedFileId || customUrl.trim()
                ? 'bg-[#00f0ff] hover:bg-[#33f3ff] shadow-[0_0_12px_rgba(0,240,255,0.4)] cursor-pointer'
                : 'bg-[#2b2d31] text-[#949ba4] cursor-not-allowed'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Tether to Transmission</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
