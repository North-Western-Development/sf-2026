import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0B0E14] disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

    const variants = {
      primary: 'bg-[#00F0FF] text-[#07090E] hover:bg-[#33F3FF] font-semibold shadow-[0_0_20px_rgba(0,240,255,0.35)] focus:ring-[#00F0FF]',
      secondary: 'bg-[#7928CA] text-white hover:bg-[#9B45E8] shadow-[0_0_20px_rgba(121,40,202,0.35)] focus:ring-[#7928CA]',
      ghost: 'bg-transparent text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222E] focus:ring-[#232936]',
      danger: 'bg-[#FF3366] text-white hover:bg-[#FF4D7D] shadow-[0_0_20px_rgba(255,51,102,0.35)] focus:ring-[#FF3366]',
      outline: 'border border-[#232936] text-[#F0F4F8] hover:bg-[#1C222E] hover:border-[#00F0FF]/40 focus:ring-[#00F0FF]',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 h-8 gap-1.5',
      md: 'text-sm px-4 py-2 h-10 gap-2',
      lg: 'text-base px-6 py-3 h-12 gap-2.5',
      icon: 'h-10 w-10 p-0',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
        {...props}
      >
        {isLoading ? (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
