import React, { useState } from 'react';
import { Network, Check } from 'lucide-react';
import { Modal } from '@subspace/ui';

interface CreateMeshModalProps {
  isOpen: boolean;
  onClose: () => void;
  friends: any[];
  onMeshCreated: (mesh: any) => void;
}

export const CreateMeshModal: React.FC<CreateMeshModalProps> = ({
  isOpen,
  onClose,
  friends,
  onMeshCreated,
}) => {
  const [meshName, setMeshName] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleSelectFriend = (id: string) => {
    if (selectedFriendIds.includes(id)) {
      setSelectedFriendIds(prev => prev.filter(fId => fId !== id));
    } else {
      if (selectedFriendIds.length >= 9) { // 1 self + 9 friends = 10 max
        alert('Subspace Meshes support a maximum of 10 participants.');
        return;
      }
      setSelectedFriendIds(prev => [...prev, id]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meshName.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const token = localStorage.getItem('subspace_access_token') || '';
      const res = await fetch('/api/v1/meshes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: meshName.trim(),
          memberIds: selectedFriendIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create mesh' }));
        throw new Error(err.error || 'Failed to initialize Subspace Mesh');
      }

      const data = await res.json();
      onMeshCreated(data.mesh);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error creating mesh');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Initialize Subspace Mesh" fixedDimensions={true}>
      <form onSubmit={handleSubmit} className="flex flex-col h-full text-xs text-[#dbdee1] select-none justify-between space-y-4">
        <div className="space-y-4">
          <div className="bg-[#111214] border border-[#1f2024] p-3 rounded-[8px] flex items-center gap-3">
            <Network className="w-6 h-6 text-[#00f0ff] shrink-0" />
            <div>
              <h4 className="font-bold text-white text-xs">Decentralized Group DM (Subspace Mesh)</h4>
              <p className="text-[11px] text-[#949ba4] mt-0.5">
                Up to 10 affiliated transmitters connected in a multi-party encrypted communication mesh.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider block">
              MESH IDENTIFIER
            </label>
            <input
              type="text"
              value={meshName}
              onChange={e => setMeshName(e.target.value)}
              placeholder="e.g. Orbital Squadron Delta"
              className="w-full bg-[#0b0c0e] border border-[#1f2024] rounded-[6px] px-3 py-2 text-xs text-white placeholder-[#80848e] focus:outline-none focus:border-[#00f0ff]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] uppercase font-bold text-[#949ba4] tracking-wider">
                SELECT TRANSMITTERS ({selectedFriendIds.length + 1}/10)
              </label>
              <span className="text-[10px] text-[#80848e]">You are automatically included</span>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {friends.length === 0 ? (
                <div className="text-center py-6 text-[#80848e] bg-[#080809] border border-[#1f2024] rounded-[6px]">
                  No affiliated transmitters online.
                </div>
              ) : (
                friends.map(f => {
                  const isSelected = selectedFriendIds.includes(f.id);
                  return (
                    <div
                      key={f.id}
                      onClick={() => toggleSelectFriend(f.id)}
                      className={`p-2.5 rounded-[6px] border flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-[#00f0ff] bg-[#00f0ff]/10 text-white font-semibold'
                          : 'border-[#1f2024] bg-[#0b0c0e] text-[#949ba4] hover:border-[#35363c]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-black border border-[#1f2024] flex items-center justify-center text-xs">
                          {f.user?.avatar || '👨‍🚀'}
                        </div>
                        <span className="text-white text-xs">{f.user?.name || f.user?.callsign}</span>
                        <span className="text-[10px] text-[#80848e]">@{f.user?.callsign}</span>
                      </div>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                        isSelected ? 'border-[#00f0ff] bg-[#00f0ff] text-black' : 'border-[#3f4147]'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {error && (
            <div className="p-2 rounded bg-[#f23f43]/20 border border-[#f23f43] text-[#f23f43] text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[#1f2024]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[4px] text-xs font-semibold text-[#dbdee1] hover:underline"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !meshName.trim()}
            className="px-4 py-2 rounded-[4px] text-xs font-semibold bg-[#00f0ff] hover:bg-[#00f0ff]/80 text-black transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Establish Mesh'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
