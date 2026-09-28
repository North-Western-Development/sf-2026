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
import { toast, confirmAction } from './app/ui';
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
      toast(`Action failed: ${err.message}`, 'error');
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
      toast(`Quarantine failed: ${err.message}`, 'error');
    }
  };

  const handleToggleBan = (userId: string, isBanned: boolean) => {
    const action = isBanned ? 'unban' : 'ban';
    confirmAction({
      title: isBanned ? 'Lift Instance Ban' : 'Ban Transmitter',
      body: `Are you sure you want to ${action} this transmitter across the whole instance?`,
      confirmLabel: isBanned ? 'Unban' : 'Ban',
      danger: !isBanned,
      onConfirm: () => runBanAction(userId, action),
    });
  };

  const runBanAction = async (userId: string, action: 'ban' | 'unban') => {
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
        toast(err.error || `Failed to ${action}`, 'error');
      }
    } catch (err: any) {
      toast(`Action error: ${err.message}`, 'error');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Command Console — Staff Administration" fixedDimensions={true}>
      <div className="flex gap-6 h-full min-h-0 text-xs text-fg select-none">
        {/* Left Nav */}
        <div className="w-48 flex flex-col gap-1 border-r border-line pr-4 shrink-0 font-medium">
          <div className="text-[10px] uppercase font-bold text-fg-muted px-2 py-1">Command Triage</div>
          <button
            onClick={() => setActiveTab('reports')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] flex items-center justify-between transition-colors ${
              activeTab === 'reports' ? 'bg-overlay text-fg font-semibold' : 'text-fg-muted hover:bg-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-danger" />
              <span>Incident Flares</span>
            </div>
            {reports.filter(r => r.report?.status === 'open').length > 0 && (
              <span className="bg-danger text-fg text-[9px] font-bold px-1.5 py-0.2 rounded-full">
                {reports.filter(r => r.report?.status === 'open').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('transmitters')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] flex items-center gap-2 transition-colors ${
              activeTab === 'transmitters' ? 'bg-overlay text-fg font-semibold' : 'text-fg-muted hover:bg-hover'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-brand-sky" />
            <span>Transmitters</span>
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            className={`text-left px-2.5 py-1.5 rounded-[4px] flex items-center gap-2 transition-colors ${
              activeTab === 'vault' ? 'bg-overlay text-fg font-semibold' : 'text-fg-muted hover:bg-hover'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-brand-sky" />
            <span>Storage Audit</span>
          </button>

          <div className="mt-auto p-2 rounded bg-raised border border-line text-[10px] text-fg-subtle">
            <div className="font-bold text-fg flex items-center gap-1 mb-0.5">
              <Shield className="w-3 h-3 text-online" /> Clearances Active
            </div>
            Staff Clearance Rank: {staffRank >= 3 ? 'ROOT' : staffRank >= 2 ? 'ADMIN' : 'MODERATOR'}
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
          {statusMessage && (
            <div className="mb-3 p-2 rounded bg-online/10 border border-online/30 text-online text-xs flex items-center justify-between">
              <span>{statusMessage}</span>
              <button onClick={() => setStatusMessage(null)} className="text-fg-muted hover:text-fg">✕</button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-20 text-fg-muted">Querying command telemetry...</div>
          ) : activeTab === 'reports' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-fg">Active Incident Flares</h3>
                  <p className="text-[11px] text-fg-muted">Frozen telemetry and evidence snapshots reported by transmitters.</p>
                </div>
                <button onClick={loadData} className="p-1.5 rounded bg-raised hover:bg-overlay text-fg-muted">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {reports.length === 0 ? (
                <div className="text-center py-12 text-fg-muted bg-base border border-line rounded-[8px]">
                  <CheckCircle2 className="w-8 h-8 text-online mx-auto mb-2" />
                  <p className="font-semibold text-fg">All Clear</p>
                  <p className="text-[11px] mt-0.5">No open incident reports requiring Command Staff review.</p>
                </div>
              ) : (
                reports.map(({ report, reporter }) => (
                  <div key={report.id} className="bg-base border border-line p-3.5 rounded-[8px] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          report.status === 'open' ? 'bg-danger/20 text-danger border border-danger/40' : 'bg-online/20 text-online'
                        }`}>
                          {report.status}
                        </span>
                        <span className="font-bold text-fg text-xs">{report.reason.toUpperCase()}</span>
                        <span className="text-[10px] text-fg-subtle">against {report.targetType}</span>
                      </div>
                      <span className="text-[10px] font-mono text-fg-subtle">{new Date(report.createdAt).toLocaleString()}</span>
                    </div>

                    {report.telemetrySnapshot?.transmissionContent && (
                      <div className="bg-base border border-line p-2.5 rounded font-mono text-[11px] text-fg">
                        <span className="text-fg-subtle block text-[9px] uppercase font-sans font-bold mb-0.5">Snapshot Evidence:</span>
                        "{report.telemetrySnapshot.transmissionContent}"
                      </div>
                    )}

                    {report.description && (
                      <p className="text-fg text-xs">
                        <span className="text-fg-muted">Details: </span>
                        {report.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-line text-[11px]">
                      <span className="text-fg-subtle">Reported by <strong className="text-fg">@{reporter?.username || 'unknown'}</strong></span>
                      {report.status === 'open' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleResolveReport(report.id, 'dismissed')}
                            className="bg-hover hover:bg-overlay text-fg-muted hover:text-fg px-2.5 py-1 rounded transition-colors"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => handleResolveReport(report.id, 'resolved')}
                            className="bg-online hover:bg-online text-fg px-3 py-1 rounded font-semibold transition-colors"
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
                <h3 className="text-sm font-bold text-fg">Transmitter Directory</h3>
                <p className="text-[11px] text-fg-muted">Suspend malicious accounts and review staff permissions.</p>
              </div>

              <div className="space-y-2">
                {transmittersList.map(user => (
                  <div key={user.id} className="bg-base border border-line p-3 rounded-[8px] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-fg text-xs">{user.displayName || user.username}</span>
                        <span className="font-mono text-fg-subtle text-[11px]">@{user.username}</span>
                        {user.staffRank > 0 && (
                          <span className="bg-brand text-fg text-[9px] font-bold px-1.5 rounded">
                            RANK {user.staffRank}
                          </span>
                        )}
                        {user.isBanned && (
                          <span className="bg-danger/20 text-danger border border-danger text-[9px] font-bold px-1.5 rounded">
                            SUSPENDED
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-fg-subtle mt-0.5 font-mono">
                        ID: {user.id} • Registered {new Date(user.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    {staffRank >= 2 && (
                      <button
                        onClick={() => handleToggleBan(user.id, user.isBanned)}
                        className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                          user.isBanned
                            ? 'bg-online hover:bg-online text-fg'
                            : 'bg-danger/20 hover:bg-danger text-danger hover:text-fg border border-danger'
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
                <h3 className="text-sm font-bold text-fg">Vault File Quarantine</h3>
                <p className="text-[11px] text-fg-muted">Inspect public attachments and toggle quarantine locks on abusive files.</p>
              </div>

              <div className="space-y-2">
                {vaultFilesList.map(({ file, uploader }) => (
                  <div key={file.id} className="bg-base border border-line p-3 rounded-[8px] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-fg text-xs">{file.filename}</span>
                        {file.isQuarantined && (
                          <span className="bg-danger text-fg text-[9px] font-bold px-1.5 rounded">QUARANTINED</span>
                        )}
                      </div>
                      <div className="text-[10px] text-fg-subtle mt-0.5">
                        Uploaded by <strong className="text-fg">@{uploader?.username}</strong> • {(Number(file.sizeBytes) / 1024).toFixed(1)} KB • {file.mimeType}
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleQuarantine(file.id, file.isQuarantined)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        file.isQuarantined
                          ? 'bg-online text-fg'
                          : 'bg-hover hover:bg-danger/20 text-fg-muted hover:text-danger'
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
