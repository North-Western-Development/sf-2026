import React from 'react';
import { THEME } from '../theme.js';

export interface FontSelectorProps {
  selectedFont: string;
  onChange: (fontId: string) => void;
  disabled?: boolean;
}

export const FontSelector: React.FC<FontSelectorProps> = ({
  selectedFont,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="flex flex-col gap-2.5 w-full">
      <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
        Comm Interface Typography
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {THEME.fonts.map((f) => {
          const isSelected = f.id === selectedFont;
          return (
            <button
              key={f.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(f.id)}
              className={`flex flex-col text-left p-3 rounded-xl border transition-all duration-200 ${
                isSelected
                  ? 'bg-[#00F0FF]/10 border-[#00F0FF] shadow-[0_0_15px_rgba(0,240,255,0.15)] text-[#00F0FF]'
                  : 'bg-[#0B0E14] border-[#232936] text-[#94A3B8] hover:text-[#F0F4F8] hover:border-[#64748B]/50'
              }`}
            >
              <span className="text-xs font-semibold">{f.name}</span>
              <span
                className="mt-1 text-sm text-[#F0F4F8] truncate"
                style={{ fontFamily: f.family }}
              >
                Subspace Frequency 104.9 MHz
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
