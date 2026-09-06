import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, disabled, ...props }, ref) => {
    return (
      <div className="w-full flex flex-col gap-1.5 text-left">
        {label && (
          <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-3.5 text-[#94A3B8] pointer-events-none flex items-center">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            disabled={disabled}
            className={twMerge(
              clsx(
                'w-full bg-[#0B0E14] border border-[#232936] text-[#F0F4F8] placeholder-[#64748B] text-sm rounded-xl px-4 py-2.5 outline-none transition-all duration-200',
                'focus:border-[#00F0FF] focus:ring-1 focus:ring-[#00F0FF]/30 focus:shadow-[0_0_15px_rgba(0,240,255,0.15)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                icon && 'pl-10',
                error && 'border-[#FF3366] focus:border-[#FF3366] focus:ring-[#FF3366]/30'
              ),
              className
            )}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-[#FF3366] font-medium mt-0.5">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
