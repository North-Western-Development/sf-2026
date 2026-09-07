import React, { useState } from 'react';
import { Modal } from '@subspace/ui';
import { FolderPlus } from 'lucide-react';

interface CreateCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateCategory: (name: string) => Promise<void> | void;
}

export const CreateCategoryModal: React.FC<CreateCategoryModalProps> = ({
  isOpen,
  onClose,
  onCreateCategory,
}) => {
  const [categoryName, setCategoryName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onCreateCategory(categoryName.trim());
      setCategoryName('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Category"
      description="Group channels under a frequency band header to organize your beacon."
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4 select-none text-[#dbdee1] mt-2">
        <div>
          <label className="text-[11px] uppercase font-bold text-[#949ba4] tracking-wider block mb-1.5">
            CATEGORY NAME <span className="text-[#f23f43]">*</span>
          </label>
          <input
            type="text"
            required
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="e.g. TACTICAL RELAYS"
            className="w-full bg-[#111214] border border-[#1f2024] focus:border-[#00f0ff]/60 rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#80848e] outline-none"
            maxLength={60}
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#1f2024]">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[#949ba4] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!categoryName.trim() || isSubmitting}
            className="bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold px-5 py-2 rounded-[6px] transition-colors shadow-sm flex items-center gap-1.5"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            {isSubmitting ? 'Creating...' : 'Create Category'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
