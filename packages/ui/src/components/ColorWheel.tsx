import React, { useState } from 'react';

export interface ColorWheelProps {
  color: string;
  onChange: (hex: string) => void;
  presetColors?: string[];
  disabled?: boolean;
}

const DEFAULT_PRESETS = [
  '#00F0FF', // Quantum Cyan
  '#7928CA', // Deep Space Violet
  '#00FF88', // Emerald Beacon
  '#FFB800', // Amber Warning
  '#FF3366', // Flare Crimson
  '#38BDF8', // Stellar Blue
  '#A855F7', // Nebula Purple
  '#EC4899', // Hyper Pink
  '#F97316', // Supernova Orange
  '#10B981', // Aurora Green
  '#E2E8F0', // Starlight White
  '#64748B', // Asteroid Grey
];

export const ColorWheel: React.FC<ColorWheelProps> = ({
  color,
  onChange,
  presetColors = DEFAULT_PRESETS,
  disabled = false,
}) => {
  const [customHex, setCustomHex] = useState(color);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (!val.startsWith('#')) val = '#' + val;
    setCustomHex(val);
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      onChange(val);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 rounded-2xl bg-[#0B0E14] border border-[#232936] w-full">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
          Signal Color Accent
        </label>
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs font-mono text-[#F0F4F8]">{color.toUpperCase()}</span>
        </div>
      </div>

      {/* Preset Swatches */}
      <div className="flex flex-wrap gap-2.5">
        {presetColors.map((preset) => {
          const isSelected = preset.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => {
                setCustomHex(preset);
                onChange(preset);
              }}
              style={{ backgroundColor: preset }}
              className={`w-9 h-9 rounded-xl transition-all duration-150 cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                  : 'hover:scale-105 opacity-80 hover:opacity-100'
              }`}
              title={preset}
              aria-label={`Select color ${preset}`}
            />
          );
        })}
      </div>

      {/* Custom Picker and Hex Input */}
      <div className="flex items-center gap-3 pt-2 border-t border-[#232936]">
        <input
          type="color"
          disabled={disabled}
          value={color}
          onChange={(e) => {
            setCustomHex(e.target.value);
            onChange(e.target.value);
          }}
          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0"
        />
        <div className="flex-1">
          <input
            type="text"
            disabled={disabled}
            value={customHex}
            onChange={handleHexChange}
            placeholder="#00F0FF"
            maxLength={7}
            className="w-full font-mono text-sm bg-[#151922] border border-[#232936] text-[#F0F4F8] rounded-xl px-3 py-2 outline-none focus:border-[#00F0FF] transition-colors"
          />
        </div>
      </div>
    </div>
  );
};
