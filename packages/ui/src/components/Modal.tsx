import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  fixedDimensions?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  fixedDimensions = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  }[maxWidth];

  const sizeClasses = fixedDimensions
    ? 'w-[840px] h-[600px] max-w-[95vw] max-h-[85vh] flex flex-col'
    : `w-full ${maxWidthClass}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative ${sizeClasses} bg-[#080809] border border-[#1e1f22] shadow-[0_0_30px_rgba(0,0,0,0.9)] rounded-2xl p-6 text-[#F0F4F8] transition-all transform animate-scale-up`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222E] p-1.5 rounded-lg transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {title && (
          <div className="mb-4 pr-8">
            <h3 className="text-xl font-semibold tracking-wide text-[#F0F4F8]">{title}</h3>
            {description && <p className="mt-1 text-sm text-[#94A3B8] leading-relaxed">{description}</p>}
          </div>
        )}

        <div className={`mt-2 ${fixedDimensions ? 'flex-1 min-h-0 overflow-y-auto' : ''}`}>{children}</div>
      </div>
    </div>
  );
};
