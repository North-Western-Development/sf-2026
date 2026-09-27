import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Users, 
  HardDrive, 
  CheckCircle2, 
  Shield, 
  Lock, 
  Unlock, 
  RefreshCw
} from 'lucide-react';
import { Modal } from '@subspace/ui';

import { api } from './services/api';
interface CommandConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffRank: number;
}

export const CommandConsoleModal: React.FC<CommandConsoleModalProps> = ({
  isOpen,
  onClose,
  staffRank,
}) => {
  const [activeTab, setActiveTab] = useState<'reports' | 'transmitters' | 'vault' | 'beacons'>('reports');
  const [reports, setReports] = useState<any[]>([]);
  const [transmittersList, setTransmittersList] = useState<any[]>([]);
  const [vaultFilesList, setVaultFilesList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      if (activeTab === 'reports') {
        const res = await api.request('/api/v1/console/reports', {
        });
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || []);
        }
      } else if (activeTab === 'transmitters') {
        const res = await api.request('/api/v1/console/transmitters', {
        });
        if (res.ok) {
          const data = await res.json();
          setTransmittersList(data.transmitters || []);
        }
      } else if (activeTab === 'vault') {
        const res = await api.request('/api/v1/console/vault/files', {
        });
        if (res.ok) {
          const data = await res.json();
          setVaultFilesList(data.files || []);
        }
      }
    } catch (err: any) {
      console.warn('Command Console load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleResolveReport = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      const res = await api.request(`/api/v1/console/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolutionNotes: `Marked ${status} by staff.` }),
      });
      if (res.ok) {
        setStatusMessage(`Report ${reportId.slice(0, 6)} updated to ${status}`);
        loadData();
      }
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const handleToggleQuarantine = async (fileId: string, currentQuarantined: boolean) => {
    try {
      const res = await api.request(`/api/v1/console/vault/files/${fileId}/quarantine`, {
        method: 'PATCH',
        body: JSON.stringify({ isQuarantined: !currentQuarantined }),
      });
      if (res.ok) {
        setStatusMessage(`Quarantine status updated.`);
        loadData();
      }
    } catch (err: any) {
      alert(`Quarantine failed: ${err.message}`);
    }
  };

  const handleToggleBan = async (userId: string, isBanned: boolean) => {
    const action = isBanned ? 'unban' : 'ban';
    if (!confirm(`Are you sure you want to ${action} transmitter ${userId}?`)) return;
    try {
      const res = await api.request(`/api/v1/console/transmitters/${userId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Command Console staff administrative action' }),
      });
      if (res.ok) {
        setStatusMessage(`Transmitter ${action}ned successfully.`);
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || `Failed to ${action}`);
      }
    } catch (err: any) {
      alert(`Action error: ${err.message}`);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Command Console — Staff Administration" fixedDimensions={true}>
      <div className="flex gap-6 h-full min-h-0 text-xs text-[#dbdee1] select-none">
        {/* Left Nav */}
        <div className="w-48 flex flex-col gap-1 border-r border-[#1f2024] pr-4 shrink-0 font-medium">
          <div className="text-[10px] uppercase font-bold text-[#949ba4] px-2 py-1">Command Triage</div>
          <button
            onClick={() => setActiveTab('reports')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] flex items-center justify-between transition-colors ${
              activeTab === 'reports' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-[#f23f43]" />
              <span>Incident Flares</span>
            </div>
            {reports.filter(r => r.report?.status === 'open').length > 0 && (
              <span className="bg-[#f23f43] text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full">
                {reports.filter(r => r.report?.status === 'open').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('transmitters')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] flex items-center gap-2 transition-colors ${
              activeTab === 'transmitters' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-[#00f0ff]" />
            <span>Transmitters</span>
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] flex items-center gap-2 transition-colors ${
              activeTab === 'vault' ? 'bg-[#1f2024] text-white font-semibold' : 'text-[#949ba4] hover:bg-[#16171a]'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-[#eb459e]" />
            <span>Storage Audit</span>
          </button>

          <div className="mt-auto p-2 rounded bg-[#111214] border border-[#1f2024] text-[10px] text-[#80848e]">
            <div className="font-bold text-white flex items-center gap-1 mb-0.5">
              <Shield className="w-3 h-3 text-[#23a55a]" /> Clearances Active
            </div>
            Staff Clearance Rank: {staffRank >= 3 ? 'ROOT' : staffRank >= 2 ? 'ADMIN' : 'MODERATOR'}
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
          {statusMessage && (
            <div className="mb-3 p-2 rounded bg-[#23a55a]/10 border border-[#23a55a]/30 text-[#23a55a] text-xs flex items-center justify-between">
              <span>{statusMessage}</span>
              <button onClick={() => setStatusMessage(null)} className="text-[#949ba4] hover:text-white">✕</button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-20 text-[#949ba4]">Querying command telemetry...</div>
          ) : activeTab === 'reports' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Active Incident Flares</h3>
                  <p className="text-[11px] text-[#949ba4]">Frozen telemetry and evidence snapshots reported by transmitters.</p>
                </div>
                <button onClick={loadData} className="p-1.5 rounded bg-[#111214] hover:bg-[#1a1b1e] text-[#949ba4]">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {reports.length === 0 ? (
                <div className="text-center py-12 text-[#949ba4] bg-[#080809] border border-[#1f2024] rounded-[8px]">
                  <CheckCircle2 className="w-8 h-8 text-[#23a55a] mx-auto mb-2" />
                  <p className="font-semibold text-white">All Clear</p>
                  <p className="text-[11px] mt-0.5">No open incident reports requiring Command Staff review.</p>
                </div>
              ) : (
                reports.map(({ report, reporter }) => (
                  <div key={report.id} className="bg-[#0b0c0e] border border-[#1f2024] p-3.5 rounded-[8px] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          report.status === 'open' ? 'bg-[#f23f43]/20 text-[#f23f43] border border-[#f23f43]/40' : 'bg-[#23a55a]/20 text-[#23a55a]'
                        }`}>
                          {report.status}
                        </span>
                        <span className="font-bold text-white text-xs">{report.reason.toUpperCase()}</span>
                        <span className="text-[10px] text-[#80848e]">against {report.targetType}</span>
                      </div>
                      <span className="text-[10px] font-mono text-[#80848e]">{new Date(report.createdAt).toLocaleString()}</span>
                    </div>

                    {report.telemetrySnapshot?.transmissionContent && (
                      <div className="bg-[#080809] border border-[#1f2024] p-2.5 rounded font-mono text-[11px] text-white">
                        <span className="text-[#80848e] block text-[9px] uppercase font-sans font-bold mb-0.5">Snapshot Evidence:</span>
                        "{report.telemetrySnapshot.transmissionContent}"
                      </div>
                    )}

                    {report.description && (
                      <p className="text-[#dbdee1] text-xs">
                        <span className="text-[#949ba4]">Details: </span>
                        {report.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-[#1a1b1e] text-[11px]">
                      <span className="text-[#80848e]">Reported by <strong className="text-white">@{reporter?.username || 'unknown'}</strong></span>
                      {report.status === 'open' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleResolveReport(report.id, 'dismissed')}
                            className="bg-[#16171a] hover:bg-[#1f2024] text-[#949ba4] hover:text-white px-2.5 py-1 rounded transition-colors"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => handleResolveReport(report.id, 'resolved')}
                            className="bg-[#23a55a] hover:bg-[#1f934f] text-white px-3 py-1 rounded font-semibold transition-colors"
                          >
                            Resolve & Action
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : activeTab === 'transmitters' ? (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white">Transmitter Directory</h3>
                <p className="text-[11px] text-[#949ba4]">Suspend malicious accounts and review staff permissions.</p>
              </div>

              <div className="space-y-2">
                {transmittersList.map(user => (
                  <div key={user.id} className="bg-[#0b0c0e] border border-[#1f2024] p-3 rounded-[8px] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{user.displayName || user.username}</span>
                        <span className="font-mono text-[#80848e] text-[11px]">@{user.username}</span>
                        {user.staffRank > 0 && (
                          <span className="bg-[#5865f2] text-white text-[9px] font-bold px-1.5 rounded">
                            RANK {user.staffRank}
                          </span>
                        )}
                        {user.isBanned && (
                          <span className="bg-[#f23f43]/20 text-[#f23f43] border border-[#f23f43] text-[9px] font-bold px-1.5 rounded">
                            SUSPENDED
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#80848e] mt-0.5 font-mono">
                        ID: {user.id} • Registered {new Date(user.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    {staffRank >= 2 && (
                      <button
                        onClick={() => handleToggleBan(user.id, user.isBanned)}
                        className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                          user.isBanned
                            ? 'bg-[#23a55a] hover:bg-[#1f934f] text-white'
                            : 'bg-[#f23f43]/20 hover:bg-[#f23f43] text-[#f23f43] hover:text-white border border-[#f23f43]'
                        }`}
                      >
                        {user.isBanned ? 'Lift Suspension' : 'Suspend Transmitter'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white">Vault File Quarantine</h3>
                <p className="text-[11px] text-[#949ba4]">Inspect public attachments and toggle quarantine locks on abusive files.</p>
              </div>

              <div className="space-y-2">
                {vaultFilesList.map(({ file, uploader }) => (
                  <div key={file.id} className="bg-[#0b0c0e] border border-[#1f2024] p-3 rounded-[8px] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{file.filename}</span>
                        {file.isQuarantined && (
                          <span className="bg-[#f23f43] text-white text-[9px] font-bold px-1.5 rounded">QUARANTINED</span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#80848e] mt-0.5">
                        Uploaded by <strong className="text-white">@{uploader?.username}</strong> • {(Number(file.sizeBytes) / 1024).toFixed(1)} KB • {file.mimeType}
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleQuarantine(file.id, file.isQuarantined)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        file.isQuarantined
                          ? 'bg-[#23a55a] text-white'
                          : 'bg-[#16171a] hover:bg-[#f23f43]/20 text-[#949ba4] hover:text-[#f23f43]'
                      }`}
                    >
                      {file.isQuarantined ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{file.isQuarantined ? 'Release Lock' : 'Quarantine'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
